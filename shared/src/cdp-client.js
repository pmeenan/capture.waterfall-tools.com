/**
 * A Chrome DevTools Protocol client over any transport that can carry text
 * messages: an ADB socket, the extension's port, the helper's WebSocket.
 *
 * Every command is checked against the shared allowlist before it is sent, so
 * the pipeline cannot come to depend on something the relays would refuse.
 * Timeouts use the worker-backed clock, never page timers (RE-015).
 */

import { vetCommand } from './cdp-allowlist.js';
import { TimeoutError } from './clock.js';

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
    /** @type {(error: unknown) => void} */
    #onListenerError;
    /** Commands not answered yet. `finish` settles one, whichever way it ends, and releases what it held. */
    /** @type {Map<number, {method: string, finish: (error: Error | null, result?: any) => void}>} */
    #pending = new Map();
    /** @type {Set<(event: CdpEvent) => void>} */
    #listeners = new Set();
    /** Event waits that have not settled yet; each can be failed from outside. */
    /** @type {Set<{method: string, fail: (error: Error) => void}>} */
    #waits = new Set();

    /**
     * @param {CdpTransport} transport
     * @param {object} options
     * @param {import('./clock.js').Clock} options.clock
     * @param {(method: string, params?: Record<string, unknown>) => string | null} [options.vet] defaults to the shared allowlist
     * @param {(error: unknown) => void} [options.onListenerError] told when an event listener throws; defaults to the console
     */
    constructor(transport, { clock, vet = vetCommand, onListenerError = (error) => console.error('CDP event listener failed:', error) }) {
        this.#transport = transport;
        this.#clock = clock;
        this.#vet = vet;
        this.#onListenerError = onListenerError;
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
     * @param {object} [options]
     * @param {number} [options.timeoutMs] give up after this long; by default a command waits until the connection closes
     * @param {AbortSignal} [options.signal] stops waiting for the answer, for example when the user cancels a run
     * @returns {Promise<any>}
     */
    send(method, params = {}, sessionId, { timeoutMs, signal } = {}) {
        if (this.#closed) return Promise.reject(new CdpError('CDP connection closed', method));
        const refusal = this.#vet(method, params);
        if (refusal) return Promise.reject(new CdpError(refusal, method));
        if (signal?.aborted) return Promise.reject(new CdpError(`${method} was cancelled`, method));
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            let cancelTimer = () => {};
            // Giving up on a command does not stop the browser running it: an answer that arrives
            // afterwards finds nothing waiting and is dropped.
            /** @param {Error | null} error @param {any} [result] */
            const finish = (error, result) => {
                if (!this.#pending.delete(id)) return;
                cancelTimer();
                signal?.removeEventListener('abort', onAbort);
                if (error) reject(error);
                else resolve(result);
            };
            const onAbort = () => finish(new CdpError(`${method} was cancelled`, method));
            this.#pending.set(id, { method, finish });
            try {
                if (timeoutMs !== undefined) cancelTimer = this.#clock.after(timeoutMs, () => finish(new TimeoutError(`${method} timed out after ${timeoutMs} ms`)), finish);
                signal?.addEventListener('abort', onAbort, { once: true });
                this.#transport.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
            } catch (error) {
                // A transport that throws - a socket already closing - must not leave the command waiting.
                finish(error instanceof Error ? error : new CdpError(String(error), method));
            }
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
     * @param {AbortSignal} [options.signal] cancels the wait, for example when the user cancels a run
     * @returns {Promise<any>} the event's params
     */
    waitFor(method, { sessionId, predicate, timeoutMs = 30000, signal } = {}) {
        if (this.#closed) return Promise.reject(new CdpError('CDP connection closed', method));
        if (signal?.aborted) return Promise.reject(new CdpError(`waiting for ${method} was cancelled`, method));
        return new Promise((resolve, reject) => {
            // Whichever way the wait ends - the event, the timeout, cancellation, or the connection
            // closing - its listener, its timer and its abort handler are all released. A wait left
            // behind would keep a run from ever finishing its cleanup.
            let cancelTimer = () => {};
            /** @param {() => void} settle */
            const finish = (settle) => {
                if (!this.#waits.delete(wait)) return;
                unsubscribe();
                cancelTimer();
                signal?.removeEventListener('abort', onAbort);
                settle();
            };
            const wait = { method, fail: (/** @type {Error} */ error) => finish(() => reject(error)) };
            const onAbort = () => wait.fail(new CdpError(`waiting for ${method} was cancelled`, method));
            this.#waits.add(wait);
            const unsubscribe = this.onEvent((event) => {
                if (event.method !== method) return;
                if (sessionId !== undefined && event.sessionId !== sessionId) return;
                try {
                    if (predicate && !predicate(event.params)) return;
                } catch (error) {
                    wait.fail(error instanceof Error ? error : new CdpError(String(error), method));
                    return;
                }
                finish(() => resolve(event.params));
            });
            try {
                // If the clock stops, the timeout can never fire, so the wait ends with it.
                cancelTimer = this.#clock.after(timeoutMs, () => wait.fail(new TimeoutError(`waiting for ${method} timed out after ${timeoutMs} ms`)), wait.fail);
            } catch (error) {
                wait.fail(error instanceof Error ? error : new CdpError(String(error), method));
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    /** Close the transport. Commands and event waits still outstanding are rejected. */
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
        // Valid JSON is not necessarily an object: `null`, a number or a string must not throw here.
        if (message === null || typeof message !== 'object') return;
        if (typeof message.id === 'number') {
            const waiting = this.#pending.get(message.id);
            if (!waiting) return;
            if (message.error) waiting.finish(new CdpError(String(message.error.message ?? message.error), waiting.method, message.error.code));
            else waiting.finish(null, message.result);
        } else if (typeof message.method === 'string') {
            /** @type {CdpEvent} */
            const event = { method: message.method, params: message.params, sessionId: message.sessionId };
            // One listener that throws must not keep the event from the others: a wait for the
            // load event may be among them.
            for (const listener of [...this.#listeners]) {
                try {
                    listener(event);
                } catch (error) {
                    this.#onListenerError(error);
                }
            }
        }
    }

    /** @param {CdpError} error */
    #fail(error) {
        if (this.#closed) return;
        this.#closed = true;
        for (const waiting of [...this.#pending.values()]) waiting.finish(new CdpError(error.message, waiting.method));
        for (const wait of [...this.#waits]) wait.fail(new CdpError(error.message, wait.method));
    }
}
