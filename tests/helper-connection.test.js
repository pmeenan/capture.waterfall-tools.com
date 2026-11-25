// The capture page's side of the helper (site/src/helper-connection.js): taking the pairing link
// out of the address bar, waiting through Chrome's loopback prompt, pairing, launching, and the
// CDP transport the shared client runs over. A fake socket stands in for the helper; the real one
// is exercised in tests/helper-server.test.js and tests/helper-chrome.test.js.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '@capture/shared/clock';
import { CdpClient } from '@capture/shared/cdp-client';
import { FAILURE, HELPER_PROTOCOL, HelperConnection, forgetPairing, parsePairing, takePairing } from '../site/src/helper-connection.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';

const SECRET = 'A'.repeat(42) + 'b';

/** An in-memory Storage. */
function memoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    return /** @type {Storage} */ (/** @type {unknown} */ ({
        getItem: (/** @type {string} */ k) => map.get(k) ?? null,
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => { map.set(k, v); },
        removeItem: (/** @type {string} */ k) => { map.delete(k); },
    }));
}

/** @param {string} hash */
function fakeLocation(hash) {
    const location = { hash, pathname: '/', search: '?x=1' };
    const history = {
        state: null,
        replaceState: vi.fn((/** @type {any} */ _s, /** @type {string} */ _t, /** @type {string} */ url) => {
            const i = url.indexOf('#');
            location.hash = i >= 0 ? url.slice(i) : '';
        }),
    };
    return { location: /** @type {Location} */ (/** @type {unknown} */ (location)), history: /** @type {History} */ (/** @type {unknown} */ (history)) };
}

describe('pairing link', () => {
    it.each([
        [`1234:${SECRET}`, { port: 1234, secret: SECRET }],
        [`0:${SECRET}`, null],
        [`70000:${SECRET}`, null],
        ['1234:short', null],
        [`1234:${SECRET}!`, null],
        [`x:${SECRET}`, null],
    ])('parses %j', (value, expected) => {
        expect(parsePairing(value)).toEqual(expected);
    });

    it('takes the pairing out of the address bar at once and keeps it for this tab', () => {
        const storage = memoryStorage();
        const { location, history } = fakeLocation(`#helper=4321:${SECRET}&other=1`);
        expect(takePairing({ location, history, storage })).toEqual({ port: 4321, secret: SECRET });
        expect(history.replaceState).toHaveBeenCalledTimes(1);
        expect(location.hash).toBe('#other=1');
        // A reload of the tab finds it in storage, with nothing in the address bar.
        const reloaded = fakeLocation('');
        expect(takePairing({ ...reloaded, storage })).toEqual({ port: 4321, secret: SECRET });
        expect(reloaded.history.replaceState).not.toHaveBeenCalled();
        forgetPairing(storage);
        expect(takePairing({ ...fakeLocation(''), storage })).toBeNull();
    });

    it('removes a malformed pairing from the address bar too, and stores nothing', () => {
        const storage = memoryStorage();
        const { location, history } = fakeLocation('#helper=junk');
        expect(takePairing({ location, history, storage })).toBeNull();
        expect(location.hash).toBe('');
        expect(takePairing({ ...fakeLocation(''), storage })).toBeNull();
    });
});

/** A WebSocket double the test plays the helper through. */
class FakeSocket {
    static instances = /** @type {FakeSocket[]} */ ([]);
    /** @param {string} url */
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        /** @type {any[]} */
        this.sent = [];
        /** @type {Map<string, Set<(e: any) => void>>} */
        this.listeners = new Map();
        FakeSocket.instances.push(this);
    }
    /** @param {string} type @param {(e: any) => void} fn @param {{once?: boolean}} [opts] */
    addEventListener(type, fn, opts) {
        const set = this.listeners.get(type) ?? new Set();
        const wrapped = opts?.once ? (/** @type {any} */ e) => { set.delete(wrapped); fn(e); } : fn;
        set.add(wrapped);
        this.listeners.set(type, set);
    }
    /** @param {string} type @param {any} e */
    emit(type, e = {}) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e); }
    open() { this.readyState = 1; this.emit('open'); }
    /** @param {object} m */
    reply(m) { this.emit('message', { data: JSON.stringify(m) }); }
    /** @param {string} text */
    send(text) { this.sent.push(JSON.parse(text)); }
    /** @param {number} [code] */
    close(code = 1005) { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', { code }); }
    get last() { return this.sent[this.sent.length - 1]; }
}

describe('connecting and pairing', () => {
    /** @type {Clock} */
    let clock;
    beforeEach(() => {
        vi.useFakeTimers();
        clock = new Clock(createFakeClockWorker());
        FakeSocket.instances = [];
    });
    afterEach(() => {
        clock.dispose();
        vi.useRealTimers();
    });
    const deps = (/** @type {() => Promise<PermissionState | null>} */ queryPermission = async () => 'granted') =>
        ({ clock, WebSocketImpl: /** @type {typeof WebSocket} */ (/** @type {unknown} */ (FakeSocket)), queryPermission });
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('pairs with the secret and learns the browsers, never their paths', async () => {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps());
        const ws = FakeSocket.instances[0];
        expect(ws.url).toBe('ws://127.0.0.1:4000/');
        ws.open();
        await settle();
        expect(ws.last).toEqual({ type: 'hello', protocol: HELPER_PROTOCOL, secret: SECRET });
        ws.reply({ type: 'welcome', protocol: HELPER_PROTOCOL, version: '0.1.0', browsers: [{ channel: 'stable', path: '/should/not/be/kept' }, { bogus: true }] });
        const connection = await pending;
        expect(connection.state).toBe('paired');
        expect(connection.browsers).toEqual([{ channel: 'stable' }]);
    });

    it('reports the loopback prompt and keeps waiting through it', async () => {
        let permission = /** @type {PermissionState} */ ('prompt');
        /** @type {string[]} */
        const states = [];
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps(async () => permission), (s) => states.push(s));
        const ws = FakeSocket.instances[0];
        await vi.advanceTimersByTimeAsync(30000); // far beyond the connect limit: a prompt does not time out
        expect(states).toContain('permission-prompt');
        permission = 'granted';
        ws.open();
        await settle();
        ws.reply({ type: 'welcome', protocol: HELPER_PROTOCOL, browsers: [] });
        expect((await pending).state).toBe('paired');
    });

    it('fails clearly when the permission is denied', async () => {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps(async () => 'denied'));
        const outcome = expect(pending).rejects.toMatchObject({ code: FAILURE.permissionDenied });
        await vi.advanceTimersByTimeAsync(600);
        await outcome;
    });

    it('gives up on a helper that never answers once permission is not the issue', async () => {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps(async () => 'granted'));
        const outcome = expect(pending).rejects.toMatchObject({ code: FAILURE.timeout });
        await vi.advanceTimersByTimeAsync(11000);
        await outcome;
    });

    it('reports a refused secret as a stale link', async () => {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps());
        const outcome = expect(pending).rejects.toMatchObject({ code: FAILURE.rejected });
        const ws = FakeSocket.instances[0];
        ws.open();
        await settle();
        ws.close(4003);
        await outcome;
    });

    it('reports a helper that is not running', async () => {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, deps());
        const outcome = expect(pending).rejects.toMatchObject({ code: FAILURE.unreachable });
        FakeSocket.instances[0].close(1006);
        await vi.advanceTimersByTimeAsync(600);
        await outcome;
    });
});

describe('after pairing', () => {
    /** @type {Clock} */
    let clock;
    beforeEach(() => {
        clock = new Clock(createFakeClockWorker());
        FakeSocket.instances = [];
    });
    afterEach(() => clock.dispose());

    async function paired() {
        const pending = HelperConnection.connect({ port: 4000, secret: SECRET }, { clock, WebSocketImpl: /** @type {any} */ (FakeSocket), queryPermission: async () => 'granted' });
        const ws = FakeSocket.instances[0];
        ws.open();
        await new Promise((r) => setTimeout(r, 0));
        ws.reply({ type: 'welcome', protocol: HELPER_PROTOCOL, browsers: [{ channel: 'stable' }] });
        return { connection: await pending, ws };
    }

    it('launches, runs CDP through the relay envelope, and closes the browser', async () => {
        const { connection, ws } = await paired();
        const launched = connection.launch({ channel: 'stable', features: ['socketThrottling'] });
        expect(ws.last).toEqual({ type: 'launch', channel: 'stable', features: ['socketThrottling'], headless: false, netLog: false });
        ws.reply({ type: 'launched', channel: 'stable' });
        await launched;

        const client = new CdpClient(connection.cdpTransport(), { clock });
        const version = client.send('Browser.getVersion');
        await new Promise((r) => setTimeout(r, 0));
        expect(ws.last).toEqual({ type: 'cdp', message: { id: 1, method: 'Browser.getVersion', params: {} } });
        ws.reply({ type: 'cdp', message: { id: 1, result: { product: 'Chrome/158' } } });
        expect(await version).toEqual({ product: 'Chrome/158' });

        const closing = connection.closeBrowser();
        expect(ws.last).toEqual({ type: 'close' });
        ws.reply({ type: 'closed', netLog: false });
        expect(await closing).toEqual({ netLog: null });
        expect(client.closed).toBe(true); // the CDP client learns the browser is gone
    });

    it('asks for a NetLog and reassembles it on close', async () => {
        const { connection, ws } = await paired();
        const launched = connection.launch({ channel: 'stable', netLog: true });
        expect(ws.last).toMatchObject({ type: 'launch', netLog: true });
        ws.reply({ type: 'launched', channel: 'stable' });
        await launched;
        const closing = connection.closeBrowser();
        ws.reply({ type: 'netlog', data: '{"events":[', last: false });
        ws.reply({ type: 'netlog', data: ']}', last: true });
        ws.reply({ type: 'closed', netLog: true });
        expect(await closing).toEqual({ netLog: '{"events":[]}' });
    });

    it('turns an error reply into a coded failure', async () => {
        const { connection, ws } = await paired();
        const launched = connection.launch({ channel: 'canary' });
        ws.reply({ type: 'error', code: 'unknown-browser' });
        await expect(launched).rejects.toMatchObject({ code: 'unknown-browser' });
    });

    it('notices when the helper goes away', async () => {
        const { connection, ws } = await paired();
        /** @type {string[]} */
        const states = [];
        connection.onState((s) => states.push(s));
        ws.close(1006);
        expect(states).toEqual(['closed']);
    });
});
