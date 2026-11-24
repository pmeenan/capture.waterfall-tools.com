// The helper's guards (D-022), as attacked in spike S8 (RE-014), plus the two M2 adds: a
// connection that never pairs is dropped, and only one connection is served at a time. A fake
// browser stands in for Chrome; tests/helper-chrome.test.js launches the real one.
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE, HELPER_PROTOCOL, PRE_AUTH_MAX_BYTES, startHelperServer } from '../helper/src/server.js';
import { connectRaw } from './helpers/raw-ws-client.js';

const ORIGIN = 'https://capture.waterfall-tools.com';
const SECRET = 'a'.repeat(43);

/** A browser that answers a few CDP commands, records what it was sent, and can exit. */
/** @typedef {{ options: object, sent: any[], closed: boolean }} LaunchRecord */
function fakeLaunch() {
    /** @type {LaunchRecord[]} */
    const launches = [];
    /** @param {{executable: string, features: string[], headless: boolean}} options */
    const launch = (options) => {
        /** @type {Set<(text: string) => void>} */
        const listeners = new Set();
        /** @type {() => void} */
        let resolveExit = () => {};
        /** @type {Promise<void>} */
        const exited = new Promise((r) => { resolveExit = () => r(undefined); });
        let nextTarget = 1;
        /** @type {LaunchRecord} */
        const record = { options, sent: [], closed: false };
        launches.push(record);
        const reply = (/** @type {object} */ m) => queueMicrotask(() => { for (const l of listeners) l(JSON.stringify(m)); });
        return {
            send(/** @type {string} */ text) {
                const m = JSON.parse(text);
                record.sent.push(m);
                if (m.method === 'Target.createTarget') reply({ id: m.id, result: { targetId: `T${nextTarget++}` } });
                else if (m.method === 'Target.attachToTarget') reply({ id: m.id, result: { sessionId: `S-${m.params.targetId}` } });
                else reply({ id: m.id, result: {} });
            },
            onMessage: (/** @type {(text: string) => void} */ l) => { listeners.add(l); },
            exited,
            async close() { record.closed = true; resolveExit(); await exited; },
        };
    };
    return { launch, launches };
}

/** @type {{ port: number, close: () => Promise<void> } | null} */
let helper = null;
async function start(extra = {}) {
    const fake = fakeLaunch();
    helper = await startHelperServer({
        captureOrigin: ORIGIN, secret: SECRET, version: '0.0.0-test',
        browsers: [{ channel: 'stable', path: '/fake/chrome' }],
        launch: fake.launch, authTimeoutMs: 300, ...extra,
    });
    return { port: /** @type {number} */ (helper?.port), fake };
}
afterEach(async () => { await helper?.close(); helper = null; });

async function pair(/** @type {number} */ port) {
    const ws = await connectRaw({ port, origin: ORIGIN });
    expect(ws.status).toBe(101);
    ws.sendJson({ type: 'hello', protocol: HELPER_PROTOCOL, secret: SECRET });
    return { ws, welcome: await ws.nextJson() };
}

describe('helper guards (D-022, RE-014)', () => {
    it('serves no plain HTTP', async () => {
        const { port } = await start();
        const status = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(res.statusCode); }));
        expect(status).toBe(404);
    });

    it.each([
        ['another site', { origin: 'https://example.com' }],
        ['no Origin', { origin: null }],
        ['an origin that only starts like ours', { origin: `${ORIGIN}.evil.example` }],
        ['http instead of https', { origin: 'http://capture.waterfall-tools.com' }],
    ])('refuses %s at connect with 403', async (_label, { origin }) => {
        const { port } = await start();
        const ws = await connectRaw({ port, origin });
        expect(ws.status).toBe(403);
    });

    it.each([
        ['a rebinding Host', (/** @type {number} */ port) => `evil.example:${port}`],
        ['no Host', () => null],
        ['the right host on another port', (/** @type {number} */ port) => `127.0.0.1:${port + 1}`],
    ])('refuses %s with 403', async (_label, host) => {
        const { port } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN, host: host(port) });
        expect(ws.status).toBe(403);
    });

    it('accepts localhost as the Host too', async () => {
        const { port } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN, host: `localhost:${port}` });
        expect(ws.status).toBe(101);
        ws.destroy();
    });

    it('closes the connection on a wrong secret, and launches nothing', async () => {
        const { port, fake } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN });
        ws.sendJson({ type: 'hello', protocol: HELPER_PROTOCOL, secret: `${SECRET}x` });
        expect((await ws.closed).code).toBe(CLOSE.badSecret);
        expect(fake.launches).toHaveLength(0);
    });

    it('closes the connection when anything but hello comes first', async () => {
        const { port, fake } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN });
        ws.sendJson({ type: 'launch', channel: 'stable' });
        expect((await ws.closed).code).toBe(CLOSE.badSecret);
        expect(fake.launches).toHaveLength(0);
    });

    it('drops a connection that never sends the secret', async () => {
        const { port } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN });
        expect((await ws.closed).code).toBe(CLOSE.authTimeout);
    });

    it('drops a connection that sends too much before pairing', async () => {
        const { port } = await start();
        const ws = await connectRaw({ port, origin: ORIGIN });
        ws.sendJson({ type: 'hello', protocol: HELPER_PROTOCOL, secret: 'x'.repeat(PRE_AUTH_MAX_BYTES + 10) });
        expect((await ws.closed).code).toBe(CLOSE.tooBig);
    });

    it('serves one paired connection at a time, and a second once the first is gone', async () => {
        const { port } = await start();
        const first = await pair(port);
        expect(first.welcome).toMatchObject({ type: 'welcome', protocol: HELPER_PROTOCOL, browsers: [{ channel: 'stable' }] });
        expect(JSON.stringify(first.welcome)).not.toContain('/fake/chrome'); // paths name the user
        const second = await connectRaw({ port, origin: ORIGIN });
        expect(second.status).toBe(409);
        first.ws.destroy();
        await new Promise((r) => setTimeout(r, 50));
        const third = await pair(port);
        expect(third.welcome.type).toBe('welcome');
        third.ws.destroy();
    });
});

describe('helper control protocol', () => {
    it('launches only a found channel with known features, and closes the browser when the connection ends', async () => {
        const { port, fake } = await start();
        const { ws } = await pair(port);
        ws.sendJson({ type: 'launch', channel: 'canary' });
        expect(await ws.nextJson()).toEqual({ type: 'error', code: 'unknown-browser' });
        ws.sendJson({ type: 'launch', channel: 'stable', features: ['--disable-web-security'] });
        expect(await ws.nextJson()).toEqual({ type: 'error', code: 'unknown-feature' });
        ws.sendJson({ type: 'launch', channel: 'stable', features: ['socketThrottling'], headless: true });
        expect(await ws.nextJson()).toEqual({ type: 'launched', channel: 'stable' });
        expect(fake.launches[0].options).toEqual({ executable: '/fake/chrome', features: ['socketThrottling'], headless: true });
        ws.sendJson({ type: 'launch', channel: 'stable' });
        expect(await ws.nextJson()).toEqual({ type: 'error', code: 'already-launched' });
        ws.destroy();
        await new Promise((r) => setTimeout(r, 50));
        expect(fake.launches[0].closed).toBe(true);
    });

    it('relays allowed CDP and refuses the rest through the relay', async () => {
        const { port, fake } = await start();
        const { ws } = await pair(port);
        ws.sendJson({ type: 'cdp', message: { id: 1, method: 'Browser.getVersion' } });
        expect(await ws.nextJson()).toEqual({ type: 'error', code: 'no-browser' });
        ws.sendJson({ type: 'launch', channel: 'stable' });
        await ws.nextJson();

        ws.sendJson({ type: 'cdp', message: { id: 2, method: 'Target.createTarget', params: { url: 'about:blank' } } });
        expect(await ws.nextJson()).toEqual({ type: 'cdp', message: { id: 2, result: { targetId: 'T1' } } });
        ws.sendJson({ type: 'cdp', message: { id: 3, method: 'Page.navigate', params: { url: 'file:///etc/passwd' } } });
        const refused = await ws.nextJson();
        expect(refused.message.error.message).toMatch(/may only load/);
        ws.sendJson({ type: 'cdp', message: { id: 4, method: 'Target.attachToTarget', params: { targetId: 'not-mine', flatten: true } } });
        expect((await ws.nextJson()).message.error.message).toMatch(/only allowed for targets this page created/);
        expect(fake.launches[0].sent.map((/** @type {any} */ m) => m.method)).toEqual(['Target.createTarget']);
        ws.destroy();
    });

    it('closes the browser on request and reports it', async () => {
        const { port, fake } = await start();
        const { ws } = await pair(port);
        ws.sendJson({ type: 'launch', channel: 'stable' });
        await ws.nextJson();
        ws.sendJson({ type: 'close' });
        expect(await ws.nextJson()).toEqual({ type: 'closed' });
        expect(fake.launches[0].closed).toBe(true);
        ws.destroy();
    });
});
