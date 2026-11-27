import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

process.env.ISAAC_TEST_ISOLATED = '1';
process.env.NODE_ENV = 'test';
process.env.DB_NAME_FORCE = 'americanpos_test';
process.env.DISABLE_BACKGROUND_WORKERS = 'true';

const express = require('express');
const regionPresets = require('../constants/regionPresets');
const settingsRouter = require('../routes/settings');
const SettingsStoreService = require('../services/SettingsStoreService');
const BCVRateService = require('../services/BCVRateService');
const SaleService = require('../services/SaleService');
const cache = require('../utils/cacheService');

function httpJson(url, { method = 'GET', body = null } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
                } catch {
                    resolve({ statusCode: res.statusCode, body: raw });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

test('Internacionalización Backend — Catálogo de 5 países y flujo completo POST /settings/region', async (t) => {
    await t.test('1. regionPresets cubre Venezuela, Ecuador, Colombia, Panamá y USA con reglas exactas', () => {
        const ve = regionPresets.getRegionConfig('venezuela');
        assert.equal(ve.currencyCode, 'USD');
        assert.equal(ve.secondaryCurrencyCode, 'VES');
        assert.equal(ve.taxConfig.ivaRate, 16);
        assert.equal(ve.taxConfig.igtfEnabled, true);
        assert.equal(ve.taxAuthority, 'SENIAT');
        assert.equal(regionPresets.isVenezuelaCountry('venezuela'), true);
        assert.equal(regionPresets.isSingleCurrencyCountry('venezuela'), false);

        const ec = regionPresets.getRegionConfig('Ecuador');
        assert.equal(ec.currencyCode, 'USD');
        assert.equal(ec.taxConfig.ivaRate, 15);
        assert.equal(ec.taxConfig.igtfEnabled, false);
        assert.equal(ec.taxIdLabel, 'RUC');
        assert.equal(ec.taxAuthority, 'SRI');
        assert.equal(regionPresets.isDollarOnlyCountry('ecuador'), true);
        assert.equal(regionPresets.isSingleCurrencyCountry('ecuador'), true);

        const co = regionPresets.getRegionConfig('colombia');
        assert.equal(co.currencyCode, 'COP');
        assert.equal(co.decimals, 0);
        assert.equal(co.exchangeRate, 1.0);
        assert.equal(co.autoUpdateRate, false);
        assert.equal(co.taxConfig.ivaRate, 19);
        assert.equal(co.taxIdLabel, 'NIT');
        assert.equal(co.taxAuthority, 'DIAN');
        assert.equal(regionPresets.isDollarOnlyCountry('colombia'), false);
        assert.equal(regionPresets.isSingleCurrencyCountry('colombia'), true);

        const pa = regionPresets.getRegionConfig('Panamá');
        assert.equal(pa.currencyCode, 'USD');
        assert.equal(pa.taxLabel, 'ITBMS');
        assert.equal(pa.taxConfig.ivaRate, 7);
        assert.equal(pa.taxAuthority, 'DGI');

        const us = regionPresets.getRegionConfig('USA');
        assert.equal(us.currencyCode, 'USD');
        assert.equal(us.taxLabel, 'Sales Tax');
        assert.equal(us.taxConfig.ivaRate, 7);
        assert.equal(us.taxIdLabel, 'EIN');
        assert.equal(us.taxAuthority, 'IRS');

        const es = regionPresets.getRegionConfig('España');
        assert.equal(es.id, 'espana');
        assert.equal(es.currencyCode, 'EUR');
        assert.equal(es.currencySymbol, '€');
        assert.equal(es.locale, 'es-ES');
        assert.equal(es.exchangeRate, 1.0);
        assert.equal(es.autoUpdateRate, false);
        assert.equal(es.taxConfig.ivaRate, 21);
        assert.equal(es.taxConfig.igtfEnabled, false);
        assert.equal(es.taxIdLabel, 'NIF / CIF');
        assert.equal(es.taxAuthority, 'AEAT');
        assert.equal(regionPresets.isDollarOnlyCountry('espana'), false);
        assert.equal(regionPresets.isSingleCurrencyCountry('espana'), true);
        assert.equal(regionPresets.getPresetKey('Europa'), 'espana');
        assert.ok(ve.paymentMethods.some((m) => m.id === 'cash_eur' && m.currency === 'EUR'), 'Venezuela incluye Efectivo €');
    });

    await t.test('2. Cambiar región actualiza impuestos, moneda, métodos de pago y preserva tasas USD/EUR BCV al volver a Venezuela', async () => {
        const companyId = 'bench_i18n_company';
        const memoryStore = {
            [companyId]: {
                exchangeRate: 1050.25,
                euroRate: 1142.80,
                currencyMode: 'BOTH',
                autoUpdateRate: true,
                // Simular campo legacy top-level en false que antes bloqueaba el IVA de Ecuador
                ivaEnabled: false,
                ivaRate: 0,
                igtfEnabled: true,
                igtfRate: 3,
                taxConfig: { ivaEnabled: false, ivaRate: 0, igtfEnabled: true, igtfRate: 3 },
                businessInfo: { name: 'Comercio Prueba', country: 'venezuela' }
            }
        };

        const origPersist = SettingsStoreService.persistCompanySettings;
        SettingsStoreService.persistCompanySettings = async (cid, cfg, all) => {
            memoryStore[cid] = JSON.parse(JSON.stringify(cfg));
            if (all) all[cid] = memoryStore[cid];
            cache.set('all_settings', memoryStore, 30);
        };
        cache.set('all_settings', memoryStore, 30);

        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { id: 'owner-test', companyId, role: 'superadmin', permissions: { canManageSettings: true } };
            next();
        });
        app.use('/settings', settingsRouter);

        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        try {
            const { port } = server.address();
            const base = `http://127.0.0.1:${port}/settings`;

            // A) Cambiar a ECUADOR (debe reactivar IVA 15%, apagar IGTF, moneda USD, tasa 1.0)
            const ecRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'ecuador' } });
            assert.equal(ecRes.statusCode, 200);
            assert.equal(ecRes.body.country, 'ecuador');
            assert.equal(ecRes.body.settings.ivaEnabled, true, 'Debe sincronizar ivaEnabled top-level');
            assert.equal(ecRes.body.settings.ivaRate, 15);
            assert.equal(ecRes.body.settings.igtfEnabled, false);
            assert.equal(ecRes.body.settings.lastBcvRate, 1050.25, 'Debe resguardar la tasa BCV anterior');

            const ecRate = await httpJson(`${base}/rate`);
            assert.equal(ecRate.body.rate, 1);
            assert.equal(ecRate.body.currencyMode, 'SINGLE');
            assert.equal(ecRate.body.autoUpdateRate, false);
            assert.equal(ecRate.body.currencyCode, 'USD');

            const ecTaxes = await httpJson(`${base}/taxes`);
            assert.equal(ecTaxes.body.ivaEnabled, true);
            assert.equal(ecTaxes.body.ivaRate, 15);
            assert.equal(ecTaxes.body.igtfEnabled, false);
            assert.equal(ecTaxes.body.taxLabel, 'IVA');
            assert.equal(ecTaxes.body.taxAuthority, 'SRI');

            const ecPm = await httpJson(`${base}/payment-methods`);
            assert.ok(Array.isArray(ecPm.body) && ecPm.body.length > 0);
            assert.ok(ecPm.body.every((m) => m.currency === 'USD'), 'Todos los métodos de Ecuador deben ser USD');

            // B) Cambiar a COLOMBIA (COP, tasa 1.0, sin BCV, IVA 19%, métodos COP)
            const coRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'colombia' } });
            assert.equal(coRes.statusCode, 200);
            assert.equal(coRes.body.settings.exchangeRate, 1);
            assert.equal(coRes.body.settings.currencyMode, 'SINGLE');
            assert.equal(coRes.body.settings.autoUpdateRate, false);

            const coRate = await httpJson(`${base}/rate`);
            assert.equal(coRate.body.rate, 1);
            assert.equal(coRate.body.currencyCode, 'COP');
            assert.equal(coRate.body.autoUpdateRate, false);
            assert.equal(coRate.body.taxAuthority, 'DIAN');

            const coTaxes = await httpJson(`${base}/taxes`);
            assert.equal(coTaxes.body.ivaRate, 19);
            assert.equal(coTaxes.body.igtfEnabled, false);

            const coPm = await httpJson(`${base}/payment-methods`);
            assert.ok(coPm.body.every((m) => m.currency === 'COP'), 'Todos los métodos de Colombia deben ser COP');
            assert.ok(coPm.body.some((m) => m.id === 'nequi'));

            // C) Cambiar a PANAMÁ (ITBMS 7%, USD, DGI)
            const paRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'panama' } });
            assert.equal(paRes.statusCode, 200);
            const paTaxes = await httpJson(`${base}/taxes`);
            assert.equal(paTaxes.body.taxLabel, 'ITBMS');
            assert.equal(paTaxes.body.ivaRate, 7);
            assert.equal(paTaxes.body.taxAuthority, 'DGI');

            // D) Cambiar a USA (Sales Tax 7%, USD, IRS)
            const usRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'usa' } });
            assert.equal(usRes.statusCode, 200);
            const usTaxes = await httpJson(`${base}/taxes`);
            assert.equal(usTaxes.body.taxLabel, 'Sales Tax');
            assert.equal(usTaxes.body.ivaRate, 7);
            assert.equal(usTaxes.body.taxAuthority, 'IRS');

            // E) Cambiar a ESPAÑA / EUROPA (EUR, tasa 1.0, IVA 21%, sin IGTF, AEAT, métodos EUR)
            const esRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'espana' } });
            assert.equal(esRes.statusCode, 200);
            assert.equal(esRes.body.country, 'espana');
            assert.equal(esRes.body.settings.exchangeRate, 1);
            assert.equal(esRes.body.settings.euroRate, 1);
            assert.equal(esRes.body.settings.currencyMode, 'SINGLE');
            assert.equal(esRes.body.settings.autoUpdateRate, false);

            const esRate = await httpJson(`${base}/rate`);
            assert.equal(esRate.body.rate, 1);
            assert.equal(esRate.body.euroRate, 1);
            assert.equal(esRate.body.currencyCode, 'EUR');
            assert.equal(esRate.body.currencySymbol, '€');
            assert.equal(esRate.body.taxAuthority, 'AEAT');

            const esTaxes = await httpJson(`${base}/taxes`);
            assert.equal(esTaxes.body.ivaEnabled, true);
            assert.equal(esTaxes.body.ivaRate, 21);
            assert.equal(esTaxes.body.igtfEnabled, false);

            const esPm = await httpJson(`${base}/payment-methods`);
            assert.ok(esPm.body.every((m) => m.currency === 'EUR'), 'Todos los métodos de España deben ser EUR');
            assert.ok(esPm.body.some((m) => m.id === 'bizum'));

            // F) Volver a VENEZUELA -> debe restaurar tasas BCV USD y EUR previas, BOTH, IVA 16% + IGTF 3%
            const veRes = await httpJson(`${base}/region`, { method: 'POST', body: { country: 'venezuela' } });
            assert.equal(veRes.statusCode, 200);
            assert.equal(veRes.body.settings.currencyMode, 'BOTH');
            assert.equal(veRes.body.settings.exchangeRate, 1050.25, 'Debe restaurar la tasa USD BCV resguardada');
            assert.equal(veRes.body.settings.euroRate, 1142.80, 'Debe restaurar la tasa EUR BCV resguardada');
            assert.equal(veRes.body.settings.taxConfig.ivaRate, 16);
            assert.equal(veRes.body.settings.taxConfig.igtfEnabled, true);
            assert.equal(veRes.body.settings.taxConfig.igtfRate, 3);
        } finally {
            SettingsStoreService.persistCompanySettings = origPersist;
            cache.del('all_settings');
            await new Promise((resolve) => server.close(resolve));
        }
    });

    await t.test('3. BCVRateService.parseBcvHtmlRate extrae #dolar y #euro del HTML del BCV', () => {
        const mockHtml = `
            <div id="euro" class="col-sm-12">
                <div class="col-sm-6"><span>EUR</span></div>
                <div class="col-sm-6"><strong> 58,98760000 </strong></div>
            </div>
            <div id="dolar" class="col-sm-12">
                <div class="col-sm-6"><span>USD</span></div>
                <div class="col-sm-6"><strong> 54,12340000 </strong></div>
            </div>
        `;
        assert.equal(BCVRateService.parseBcvHtmlRate(mockHtml, 'dolar'), 54.1234);
        assert.equal(BCVRateService.parseBcvHtmlRate(mockHtml, 'euro'), 58.9876);
        assert.equal(BCVRateService.parseBcvHtmlRate(mockHtml, 'inexistente'), null);
    });

    await t.test('4. SaleService._normalizePayments convierte EUR por tasa Euro BCV en Venezuela y mantiene EUR directo en España', () => {
        const vePayments = SaleService._normalizePayments(
            { paymentMethods: [{ method: 'cash_eur', amount: 10, currency: 'EUR' }] },
            11,
            50,
            { businessInfo: { country: 'venezuela' }, exchangeRate: 50, euroRate: 55 }
        );
        assert.equal(vePayments.length, 1);
        assert.equal(vePayments[0].currency, 'EUR');
        assert.equal(vePayments[0].eurRate, 55);
        assert.equal(vePayments[0].convertedAmountBs, 550);
        assert.equal(vePayments[0].convertedAmountUsd, 11);

        const esPayments = SaleService._normalizePayments(
            { paymentMethods: [{ method: 'cash', amount: 25.5, currency: 'EUR' }] },
            25.5,
            1,
            { businessInfo: { country: 'espana' }, exchangeRate: 1, euroRate: 1 }
        );
        assert.equal(esPayments.length, 1);
        assert.equal(esPayments[0].currency, 'EUR');
        assert.equal(esPayments[0].amount, 25.5);
        assert.equal(esPayments[0].convertedAmountUsd, undefined);
    });
});
