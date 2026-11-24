import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
    isPrivateOrReservedIp,
    resolvePublicTargetIp,
    createPinnedPublicLookup,
    fetchSafeImageBuffer
} = require('../utils/safeHttpImage');

test('safeHttpImage — compatibilidad Node 20/24 autoSelectFamily (lookup all:true) y anti-SSRF', async (t) => {
    await t.test('1. createPinnedPublicLookup responde array cuando opts.all === true y (addr, family) en modo clásico', async () => {
        const lookup = createPinnedPublicLookup({
            address: '93.184.216.34',
            family: 4,
            records: [
                { address: '93.184.216.34', family: 4 },
                { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
            ]
        });

        const allRes = await new Promise((resolve, reject) => {
            lookup('example.com', { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)));
        });
        assert.ok(Array.isArray(allRes), 'Debe devolver un arreglo cuando opts.all === true');
        assert.equal(allRes[0].address, '93.184.216.34');
        assert.equal(allRes[0].family, 4);

        const singleRes = await new Promise((resolve, reject) => {
            lookup('example.com', { all: false }, (err, addr, fam) => (err ? reject(err) : resolve({ addr, fam })));
        });
        assert.deepEqual(singleRes, { addr: '93.184.216.34', fam: 4 });

        const twoArgRes = await new Promise((resolve, reject) => {
            lookup('example.com', (err, addr, fam) => (err ? reject(err) : resolve({ addr, fam })));
        });
        assert.deepEqual(twoArgRes, { addr: '93.184.216.34', fam: 4 });
    });

    await t.test('2. http.request con createPinnedPublicLookup funciona en Node 24 con autoSelectFamily sin Invalid IP address', async () => {
        const server = await new Promise((resolve) => {
            const s = http.createServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('ok-node24');
            });
            s.listen(0, '127.0.0.1', () => resolve(s));
        });

        try {
            const { port } = server.address();
            const body = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: 'local-test.example',
                    port,
                    path: '/',
                    method: 'GET',
                    lookup: createPinnedPublicLookup({ address: '127.0.0.1', family: 4 })
                }, (res) => {
                    const chunks = [];
                    res.on('data', (c) => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                });
                req.on('error', reject);
                req.end();
            });
            assert.equal(body, 'ok-node24');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    await t.test('3. Protección anti-SSRF sigue bloqueando IPs privadas, loopback y hosts internos', async () => {
        assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
        assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
        assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
        assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
        assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);

        await assert.rejects(() => resolvePublicTargetIp('localhost'), /anti-SSRF/i);
        await assert.rejects(() => resolvePublicTargetIp('127.0.0.1'), /anti-SSRF/i);
        await assert.rejects(() => fetchSafeImageBuffer('http://127.0.0.1/test.png'), /anti-SSRF/i);
    });
});
