/**
 * A clock that keeps time while the page is hidden.
 *
 * The capture page spends most of a test hidden behind the tab or window under
 * test. Chrome then throttles page timers to once a second and, after five
 * minutes, to once a minute, while timers inside a dedicated worker stay
 * punctual (docs/rough-edges.md RE-015). Capture code therefore never calls
 * `setTimeout` to wait: it uses this clock, whose timers run in a worker.
 */

/**
 * The minimal worker surface the clock needs. A real `Worker` satisfies it;
 * tests supply a fake.
 * @typedef {object} ClockWorker
 * @property {(message: {type: 'set', id: number, ms: number} | {type: 'clear', id: number}) => void} postMessage
 * @property {((event: {data: {type: 'fire', id: number}}) => void) | null} onmessage
 * @property {() => void} terminate
 */

/** Source of the worker. Kept as text so it needs no separate build output. */
export const CLOCK_WORKER_SOURCE = `
const timers = new Map();
onmessage = (event) => {
  const m = event.data;
  if (m.type === 'set') {
    timers.set(m.id, setTimeout(() => { timers.delete(m.id); postMessage({ type: 'fire', id: m.id }); }, m.ms));
  } else if (m.type === 'clear') {
    clearTimeout(timers.get(m.id));
    timers.delete(m.id);
  }
};
`;

/**
 * Start the timer worker in a browser.
 * @returns {ClockWorker}
 */
export function createBrowserClockWorker() {
    const url = URL.createObjectURL(new Blob([CLOCK_WORKER_SOURCE], { type: 'text/javascript' }));
    // The URL is deliberately not revoked: the worker loads it asynchronously,
    // and one small blob per page is not worth a race.
    return /** @type {ClockWorker} */ (/** @type {unknown} */ (new Worker(url)));
}

/** Thrown by {@link Clock#timeout} when the time runs out first. */
export class TimeoutError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'TimeoutError';
    }
}

export class Clock {
    /** @type {ClockWorker} */
    #worker;
    /** @type {Map<number, () => void>} */
    #callbacks = new Map();
    #nextId = 1;
    #disposed = false;

    /** @param {ClockWorker} worker */
    constructor(worker) {
        this.#worker = worker;
        worker.onmessage = (event) => {
            const callback = this.#callbacks.get(event.data.id);
            if (callback) {
                this.#callbacks.delete(event.data.id);
                callback();
            }
        };
    }

    /** Number of timers that have been set and have neither fired nor been cancelled. */
    get pending() {
        return this.#callbacks.size;
    }

    /**
     * Run `callback` after `ms` milliseconds.
     * @param {number} ms
     * @param {() => void} callback
     * @returns {() => void} cancel
     */
    after(ms, callback) {
        if (this.#disposed) throw new Error('clock has been disposed');
        const id = this.#nextId++;
        this.#callbacks.set(id, callback);
        this.#worker.postMessage({ type: 'set', id, ms: Math.max(0, ms) });
        return () => {
            if (this.#callbacks.delete(id)) this.#worker.postMessage({ type: 'clear', id });
        };
    }

    /**
     * Resolve after `ms` milliseconds.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise((resolve) => {
            this.after(ms, resolve);
        });
    }

    /**
     * Settle with `promise`, or reject with a {@link TimeoutError} if it takes longer than `ms`.
     * @template T
     * @param {Promise<T>} promise
     * @param {number} ms
     * @param {string} [what] what was being waited for, for the error message
     * @returns {Promise<T>}
     */
    timeout(promise, ms, what = 'operation') {
        return new Promise((resolve, reject) => {
            const cancel = this.after(ms, () => reject(new TimeoutError(`${what} timed out after ${ms} ms`)));
            promise.then(
                (value) => {
                    cancel();
                    resolve(value);
                },
                (error) => {
                    cancel();
                    reject(error);
                },
            );
        });
    }

    /** Stop the worker. Timers that have not fired never will. */
    dispose() {
        this.#disposed = true;
        this.#callbacks.clear();
        this.#worker.terminate();
    }
}

/**
 * The usual way to get a clock in a browser.
 * @returns {Clock}
 */
export function createClock() {
    return new Clock(createBrowserClockWorker());
}
