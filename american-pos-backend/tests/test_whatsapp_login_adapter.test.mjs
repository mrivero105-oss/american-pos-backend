import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WhatsappWorkerRuntime } = require('../services/whatsappWorker');

test('WhatsappWorkerRuntime._installLoginRouteAdapter — ruta /login/ vs ruta principal', async (t) => {
    await t.test('1. Delega a originalInject cuando la URL no es /login/', async () => {
        const runtime = new WhatsappWorkerRuntime();
        const token = Symbol('init');
        runtime._activeInitToken = token;

        let origCalled = 0;
        const fakeClient = new EventEmitter();
        fakeClient.pupPage = {
            isClosed: () => false,
            url: () => 'https://web.whatsapp.com/'
        };
        fakeClient.inject = async () => {
            origCalled++;
        };

        runtime._installLoginRouteAdapter(fakeClient, token);
        await fakeClient.inject();
        assert.equal(origCalled, 1);
    });

    await t.test('2. En /login/ sin WAWebSocketModel lee [data-ref] y emite evento qr sin bloquearse', async () => {
        const runtime = new WhatsappWorkerRuntime();
        const token = Symbol('init');
        runtime._activeInitToken = token;
        runtime._sendIpc = () => {};

        let origCalled = 0;
        let exposedCb = null;
        const emittedQrs = [];

        const fakeClient = new EventEmitter();
        fakeClient.options = { authTimeoutMs: 10000 };
        fakeClient.authStrategy = {
            onAuthenticationNeeded: async () => ({ failed: false })
        };
        fakeClient.on('qr', (q) => emittedQrs.push(q));
        fakeClient.inject = async () => {
            origCalled++;
        };

        const sampleRef = 'https://wa.me/settings/linked_devices#2@testRef,pubKey,idKey,advSecret,1';
        let evalCount = 0;
        fakeClient.pupPage = {
            isClosed: () => false,
            url: () => 'https://web.whatsapp.com/login/',
            waitForSelector: async (sel) => {
                assert.equal(sel, '[data-ref]');
            },
            exposeFunction: async (name, fn) => {
                if (name === '__isaacOnLoginQR') exposedCb = fn;
            },
            evaluate: async () => {
                evalCount++;
                // 1a eval: comprobar hasSocketModel -> false
                if (evalCount === 1) return false;
                // 2a eval: comprobar si __isaacOnLoginQR ya existe -> false
                if (evalCount === 2) return false;
                // 3a eval: instalar MutationObserver y emitir QR inicial
                if (evalCount === 3 && exposedCb) {
                    exposedCb(sampleRef);
                }
                return undefined;
            }
        };

        runtime._installLoginRouteAdapter(fakeClient, token);
        await fakeClient.inject();
        runtime._clearLoginWatcher();

        assert.equal(origCalled, 0, 'No debe llamar a originalInject mientras sigue en /login/ sin Socket');
        assert.deepEqual(emittedQrs, [sampleRef], 'Debe emitir el payload exacto de [data-ref] como evento qr');
    });
});
