/**
 * The capture page's side of the local helper (D-017, D-022, architecture §3.7).
 *
 * Pairing: the helper prints a link whose fragment is `#helper=<port>:<secret>`. The page reads it,
 * removes it from the address bar at once (so it is not left in a screenshot or a copied URL), and
 * keeps it in sessionStorage so a reload of this tab can reconnect; it dies with the tab.
 *
 * The connection then waits on Chrome's loopback permission (RE-014): until the user answers the
 * prompt, the WebSocket neither opens nor fails, so the state machine reports that instead of
 * looking stuck. Every wait uses the worker clock, never a page timer (AGENTS.md rule 6).
 *
 * Once paired, `launch()` starts a Chrome in the helper and `cdpTransport()` gives the shared
 * CdpClient a transport over the helper's relay.
 */

export const HELPER_PROTOCOL = 1;
const STORAGE_KEY = 'capture-helper-pairing';
/** WebSocket readyState values (the spec's numbers, so a test double needs no WebSocket class). */
const CONNECTING = 0;
const OPEN = 1;
/** How long a socket may stay connecting, while the permission is not 'prompt', before giving up. */
export const CONNECT_LIMIT_MS = 10000;
/** How long the helper gets to answer each control message. */
export const REPLY_LIMIT_MS = 30000;

/**
 * @typedef {object} Pairing
 * @property {number} port
 * @property {string} secret
 */

/**
 * @param {string} value the part after `helper=`
 * @returns {Pairing | null}
 */
export function parsePairing(value) {
    const match = /^(\d{1,5}):([A-Za-z0-9_-]{43})$/.exec(value);
    if (!match) return null;
    const port = Number(match[1]);
    if (port < 1 || port > 65535) return null;
    return { port, secret: match[2] };
}

/**
 * Take the pairing from the address bar, or from this tab's storage if it was taken earlier.
 * @param {object} [deps]
 * @param {Location} [deps.location]
 * @param {History} [deps.history]
 * @param {Storage} [deps.storage]
 * @returns {Pairing | null}
 */
export function takePairing({ location = globalThis.location, history = globalThis.history, storage = globalThis.sessionStorage } = {}) {
    const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    const params = new URLSearchParams(fragment);
    const raw = params.get('helper');
    if (raw !== null) {
        // Remove it before anything else happens, whether or not it parses.
        params.delete('helper');
        const rest = params.toString();
        history.replaceState(history.state, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
        const pairing = parsePairing(raw);
        if (pairing) storage.setItem(STORAGE_KEY, JSON.stringify(pairing));
        return pairing;
    }
    try {
        const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
        return stored && parsePairing(`${stored.port}:${stored.secret}`);
    } catch {
        return null;
    }
}

/** @param {Storage} [storage] */
export function forgetPairing(storage = globalThis.sessionStorage) {
    storage.removeItem(STORAGE_KEY);
}

/**
 * @typedef {'connecting' | 'permission-prompt' | 'paired' | 'closed' | 'failed'} HelperState
 */

/** Why a connection failed, as a fixed code the UI turns into words. */
export const FAILURE = Object.freeze({
    permissionDenied: 'permission-denied',
    unreachable: 'unreachable',
    rejected: 'rejected',
    timeout: 'timeout',
    protocol: 'protocol',
});

export class HelperError extends Error {
    /** @param {string} code @param {string} [message] */
    constructor(code, message = code) {
        super(message);
        this.name = 'HelperError';
        this.code = code;
    }
}

/**
 * @typedef {object} HelperDeps
 * @property {import('@capture/shared/clock').Clock} clock
 * @property {typeof WebSocket} [WebSocketImpl]
 * @property {() => Promise<PermissionState | null>} [queryPermission] the loopback permission, or null if unknown
 */

/** @returns {Promise<PermissionState | null>} */
async function queryLoopbackPermission() {
    try {
        return (await navigator.permissions.query({ name: /** @type {PermissionName} */ ('loopback-network') })).state;
    } catch {
        return null;
    }
}

export class HelperConnection {
    /** @type {WebSocket} */
    #ws;
    /** @type {import('@capture/shared/clock').Clock} */
    #clock;
    /** @type {HelperState} */
    #state = 'connecting';
    /** @type {Set<(state: HelperState, detail?: string) => void>} */
    #stateListeners = new Set();
    /** The one control request in flight: control messages are answered in order. */
    /** @type {{ expect: string[], resolve: (m: any) => void, reject: (e: Error) => void } | null} */
    #waiting = null;
    /** @type {{ channel: string }[]} */
    browsers = [];
    version = '';
    /** @type {((text: string) => void) | null} */
    #cdpSink = null;
    /** @type {(() => void) | null} */
    #cdpClosed = null;

    /**
     * @param {WebSocket} ws
     * @param {import('@capture/shared/clock').Clock} clock
     */
    constructor(ws, clock) {
        this.#ws = ws;
        this.#clock = clock;
    }

    get state() {
        return this.#state;
    }

    /** @param {(state: HelperState, detail?: string) => void} listener */
    onState(listener) {
        this.#stateListeners.add(listener);
    }

    /** @param {HelperState} state @param {string} [detail] */
    #setState(state, detail) {
        if (this.#state === state) return;
        this.#state = state;
        for (const listener of this.#stateListeners) listener(state, detail);
    }

    /**
     * Connect and pair. Resolves once the helper has accepted the secret.
     * @param {Pairing} pairing
     * @param {HelperDeps} deps
     * @param {(state: HelperState) => void} [onState] told about states before the promise settles
     * @returns {Promise<HelperConnection>}
     */
    static async connect(pairing, { clock, WebSocketImpl = WebSocket, queryPermission = queryLoopbackPermission }, onState) {
        const ws = new WebSocketImpl(`ws://127.0.0.1:${pairing.port}/`);
        const connection = new HelperConnection(ws, clock);
        if (onState) connection.onState(onState);
        onState?.('connecting');
        try {
            await connection.#open(queryPermission);
            const welcome = await connection.#request({ type: 'hello', protocol: HELPER_PROTOCOL, secret: pairing.secret }, ['welcome']);
            if (welcome.protocol !== HELPER_PROTOCOL || !Array.isArray(welcome.browsers)) throw new HelperError(FAILURE.protocol, 'the helper speaks a different protocol');
            connection.browsers = welcome.browsers.filter((/** @type {any} */ b) => typeof b?.channel === 'string').map((/** @type {any} */ b) => ({ channel: b.channel }));
            connection.version = typeof welcome.version === 'string' ? welcome.version : '';
            connection.#setState('paired');
            return connection;
        } catch (error) {
            connection.#fail(error instanceof HelperError ? error : new HelperError(FAILURE.protocol, String(error)));
            throw error;
        }
    }

    /**
     * Wait for the socket to open. While Chrome shows its loopback prompt the socket stays
     * connecting indefinitely, so the limit only runs while the permission is not 'prompt'.
     * @param {() => Promise<PermissionState | null>} queryPermission
     */
    async #open(queryPermission) {
        const ws = this.#ws;
        ws.addEventListener('message', (event) => this.#receive(event.data));
        ws.addEventListener('close', (event) => this.#closed(event.code));
        /** @type {Promise<void>} */
        const opened = new Promise((resolve, reject) => {
            ws.addEventListener('open', () => resolve(), { once: true });
            ws.addEventListener('close', () => reject(new HelperError(FAILURE.unreachable, 'the helper is not running, or refused this page')), { once: true });
        });
        let waited = 0;
        const step = 500;
        for (;;) {
            const done = await Promise.race([opened.then(() => true), this.#clock.sleep(step).then(() => false)]);
            if (done) return;
            const permission = await queryPermission();
            if (permission === 'denied') {
                ws.close();
                throw new HelperError(FAILURE.permissionDenied, 'this site is not allowed to reach apps on this device');
            }
            if (permission === 'prompt') {
                this.#setState('permission-prompt');
                waited = 0;
                continue;
            }
            this.#setState('connecting');
            waited += step;
            if (waited >= CONNECT_LIMIT_MS) {
                ws.close();
                throw new HelperError(FAILURE.timeout, 'the helper did not answer');
            }
        }
    }

    /**
     * Send a control message and wait for one of the expected replies (or an error reply).
     * @param {object} message
     * @param {string[]} expect
     * @returns {Promise<any>}
     */
    #request(message, expect) {
        if (this.#waiting) return Promise.reject(new HelperError(FAILURE.protocol, 'another request is in progress'));
        if (this.#ws.readyState !== OPEN) return Promise.reject(new HelperError(FAILURE.unreachable, 'not connected'));
        const reply = new Promise((resolve, reject) => { this.#waiting = { expect, resolve, reject }; });
        this.#ws.send(JSON.stringify(message));
        return this.#clock.timeout(reply, REPLY_LIMIT_MS, `the helper's reply to ${/** @type {any} */ (message).type}`)
            .catch((error) => {
                this.#waiting = null;
                throw error instanceof HelperError ? error : new HelperError(FAILURE.timeout, String(error?.message ?? error));
            });
    }

    /** @param {unknown} data */
    #receive(data) {
        if (typeof data !== 'string') return;
        let message;
        try {
            message = JSON.parse(data);
        } catch {
            return;
        }
        if (message?.type === 'cdp') {
            this.#cdpSink?.(JSON.stringify(message.message));
            return;
        }
        if (message?.type === 'closed') this.#cdpClosed?.();
        const waiting = this.#waiting;
        if (!waiting) return;
        if (waiting.expect.includes(message?.type)) {
            this.#waiting = null;
            waiting.resolve(message);
        } else if (message?.type === 'error') {
            this.#waiting = null;
            waiting.reject(new HelperError(String(message.code ?? 'error')));
        }
    }

    /** @param {number} code */
    #closed(code) {
        this.#cdpClosed?.();
        const waiting = this.#waiting;
        this.#waiting = null;
        // 4003: the helper refused the secret (a different helper run, or a stale link).
        const error = code === 4003 ? new HelperError(FAILURE.rejected, 'the helper refused this pairing link') : new HelperError(FAILURE.unreachable, 'the helper connection closed');
        waiting?.reject(error);
        if (this.#state !== 'failed') this.#setState(code === 4003 ? 'failed' : 'closed', error.code);
    }

    /** @param {HelperError} error */
    #fail(error) {
        if (this.#ws.readyState === CONNECTING || this.#ws.readyState === OPEN) this.#ws.close();
        this.#setState('failed', error.code);
    }

    /**
     * Start a Chrome in the helper.
     * @param {object} options
     * @param {string} options.channel one of `browsers`
     * @param {string[]} [options.features] names the helper knows, such as 'socketThrottling'
     * @param {boolean} [options.headless]
     * @returns {Promise<void>}
     */
    async launch({ channel, features = [], headless = false }) {
        await this.#request({ type: 'launch', channel, features, headless }, ['launched']);
    }

    /** Close the helper's Chrome; resolves once it is gone and its profile deleted. */
    async closeBrowser() {
        await this.#request({ type: 'close' }, ['closed']);
    }

    /**
     * A transport for the shared CdpClient, over the helper's relay. One per launched browser.
     * @returns {import('@capture/shared/cdp-client').CdpTransport}
     */
    cdpTransport() {
        /** @type {import('@capture/shared/cdp-client').CdpTransport} */
        const transport = {
            send: (text) => {
                if (this.#ws.readyState === OPEN) this.#ws.send(JSON.stringify({ type: 'cdp', message: JSON.parse(text) }));
            },
            onMessage: null,
            onClose: null,
            close: () => {
                this.#cdpSink = null;
                this.#cdpClosed = null;
            },
        };
        this.#cdpSink = (text) => transport.onMessage?.(text);
        this.#cdpClosed = () => {
            this.#cdpSink = null;
            this.#cdpClosed = null;
            transport.onClose?.();
        };
        return transport;
    }

    /** End the pairing: the helper closes its Chrome when the connection goes. */
    disconnect() {
        if (this.#ws.readyState === CONNECTING || this.#ws.readyState === OPEN) this.#ws.close(1000);
    }
}
