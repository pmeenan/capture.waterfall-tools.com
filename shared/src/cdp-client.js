/**
 * A Chrome DevTools Protocol client over any transport that can carry text
 * messages: an ADB socket, the extension's port, the helper's WebSocket.
 *
 * Every command is checked against the shared allowlist before it is sent, so
 * the pipeline cannot come to depend on something the relays would refuse.
 * Timeouts use the worker-backed clock, never page timers (RE-015).
 */

import { vetCommand } from './cdp-allowlist.js';

/**
 * What a transport has to provide. `onMessage` and `onClose` are assigned by the client.
 * @typedef {object} CdpTransport
 * @property {(text: string) => void} send
 * @property {((text: string) => void) | null} onMessage
 * @property {(() => void) | null} onClose
 * @property {() => void} close
 */

/**
 * @typedef {object} CdpEvent
 * @property {string} method
 * @property {any} params
 * @property {string} [sessionId]
 */

/** A command the browser answered with an error, or one refused before sending. */
export class CdpError extends Error {
    /**
     * @param {string} message
     * @param {string} method
     * @param {number} [code]
     */
    constructor(message, method, code) {
        super(message);
        this.name = 'CdpError';
        this.method = method;
        this.code = code;
    }
}

export class CdpClient {
    /** @type {CdpTransport} */
    #transport;
    /** @type {import('./clock.js').Clock} */
    #clock;
    /** @type {(method: string, params?: Record<string, unknown>) => string | null} */
    #vet;
    #nextId = 1;
    #closed = false;
    /** @type {Map<number, {method: string, resolve: (value: any) => void, reject: (reason: Error) => void}>} */
    #pending = new Map();
    /** @type {Set<(event: CdpEvent) => void>} */
    #listeners = new Set();

    /**
     * @param {CdpTransport} transport
     * @param {object} options
     * @param {import('./clock.js').Clock} options.clock
     * @param {(method: string, params?: Record<string, unknown>) => string | null} [options.vet] defaults to the shared allowlist
     */
    constructor(transport, { clock, vet = vetCommand }) {
        this.#transport = transport;
        this.#clock = clock;
        this.#vet = vet;
        transport.onMessage = (text) => this.#receive(text);
        transport.onClose = () => this.#fail(new CdpError('CDP connection closed', ''));
    }

    get closed() {
        return this.#closed;
    }

    /**
     * Send a command and wait for its result.
     * @param {string} method
     * @param {Record<string, unknown>} [params]
     * @param {string} [sessionId]
     * @returns {Promise<any>}
     */
    send(method, params = {}, sessionId) {
        if (this.#closed) return Promise.reject(new CdpError('CDP connection closed', method));
        const refusal = this.#vet(method, params);
        if (refusal) return Promise.reject(new CdpError(refusal, method));
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            this.#pending.set(id, { method, resolve, reject });
            this.#transport.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        });
    }

    /**
     * Listen to every event.
     * @param {(event: CdpEvent) => void} listener
     * @returns {() => void} unsubscribe
     */
    onEvent(listener) {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /**
     * Wait for one event.
     * @param {string} method
     * @param {object} [options]
     * @param {string} [options.sessionId] only accept the event from this session
     * @param {(params: any) => boolean} [options.predicate]
     * @param {number} [options.timeoutMs]
     * @returns {Promise<any>} the event's params
     */
    waitFor(method, { sessionId, predicate, timeoutMs = 30000 } = {}) {
        /** @type {() => void} */
        let unsubscribe = () => {};
        const seen = new Promise((resolve) => {
            unsubscribe = this.onEvent((event) => {
                if (event.method !== method) return;
                if (sessionId !== undefined && event.sessionId !== sessionId) return;
                if (predicate && !predicate(event.params)) return;
                resolve(event.params);
            });
        });
        return this.#clock.timeout(seen, timeoutMs, `waiting for ${method}`).finally(unsubscribe);
    }

    /** Close the transport. Commands still waiting are rejected. */
    close() {
        if (this.#closed) return;
        this.#fail(new CdpError('CDP connection closed', ''));
        this.#transport.close();
    }

    /** @param {string} text */
    #receive(text) {
        /** @type {any} */
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return; // not ours to interpret; a malformed message must not break the session
        }
        if (typeof message.id === 'number') {
            const waiting = this.#pending.get(message.id);
            if (!waiting) return;
            this.#pending.delete(message.id);
            if (message.error) waiting.reject(new CdpError(String(message.error.message ?? message.error), waiting.method, message.error.code));
            else waiting.resolve(message.result);
        } else if (typeof message.method === 'string') {
            /** @type {CdpEvent} */
            const event = { method: message.method, params: message.params, sessionId: message.sessionId };
            for (const listener of [...this.#listeners]) listener(event);
        }
    }

    /** @param {CdpError} error */
    #fail(error) {
        if (this.#closed) return;
        this.#closed = true;
        for (const waiting of this.#pending.values()) waiting.reject(new CdpError(error.message, waiting.method));
        this.#pending.clear();
    }
}
