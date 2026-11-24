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
 * @property {((event: any) => void) | null} [onerror] the worker failed to start, or threw
 * @property {((event: any) => void) | null} [onmessageerror]
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

/** The clock stopped: it was disposed, or its worker failed. Timers it held will never fire. */
export class ClockError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'ClockError';
    }
}

export class Clock {
    /** @type {ClockWorker} */
    #worker;
    /** @type {Map<number, {fire: () => void, fail?: (error: Error) => void}>} */
    #timers = new Map();
    #nextId = 1;
    /** Why the clock stopped, once it has. @type {ClockError | null} */
    #stopped = null;

    /** @param {ClockWorker} worker */
    constructor(worker) {
        this.#worker = worker;
        worker.onmessage = (event) => {
            const timer = this.#timers.get(event.data.id);
            if (timer) {
                this.#timers.delete(event.data.id);
                timer.fire();
            }
        };
        // A worker that never started (blocked by policy, out of memory) or that threw will not
        // fire anything again. Everything waiting on it has to be told, or it waits for ever.
        /** @param {any} event */
        const failed = (event) => this.#stop(new ClockError(`the timer worker failed${event?.message ? `: ${event.message}` : ''}`));
        worker.onerror = failed;
        worker.onmessageerror = failed;
    }

    /** Number of timers that have been set and have neither fired nor been cancelled. */
    get pending() {
        return this.#timers.size;
    }

    /**
     * Run `callback` after `ms` milliseconds.
     * @param {number} ms
     * @param {() => void} callback
     * @param {(error: Error) => void} [onStop] called instead, if the clock stops before the timer fires
     * @returns {() => void} cancel
     */
    after(ms, callback, onStop) {
        if (this.#stopped) throw this.#stopped;
        const id = this.#nextId++;
        this.#timers.set(id, { fire: callback, fail: onStop });
        this.#worker.postMessage({ type: 'set', id, ms: Math.max(0, ms) });
        return () => {
            if (this.#timers.delete(id)) this.#worker.postMessage({ type: 'clear', id });
        };
    }

    /**
     * Resolve after `ms` milliseconds. Rejects with a {@link ClockError} if the clock stops first.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise((resolve, reject) => {
            this.after(ms, resolve, reject);
        });
    }

    /**
     * Settle with `promise`, or reject with a {@link TimeoutError} if it takes longer than `ms`,
     * or with a {@link ClockError} if the clock stops before either.
     * @template T
     * @param {Promise<T>} promise
     * @param {number} ms
     * @param {string} [what] what was being waited for, for the error message
     * @returns {Promise<T>}
     */
    timeout(promise, ms, what = 'operation') {
        return new Promise((resolve, reject) => {
            /** @type {() => void} */
            let cancel;
            try {
                cancel = this.after(ms, () => reject(new TimeoutError(`${what} timed out after ${ms} ms`)), reject);
            } catch (error) {
                promise.catch(() => {}); // nobody is left to hear it
                reject(error);
                return;
            }
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

    /** Stop the worker. Timers that have not fired never will; whoever waits on one is told. */
    dispose() {
        this.#stop(new ClockError('clock has been disposed'));
    }

    /** @param {ClockError} reason */
    #stop(reason) {
        if (this.#stopped) return;
        this.#stopped = reason;
        const timers = [...this.#timers.values()];
        this.#timers.clear();
        this.#worker.terminate();
        for (const timer of timers) timer.fail?.(reason);
    }
}

/**
 * The usual way to get a clock in a browser.
 * @returns {Clock}
 */
export function createClock() {
    return new Clock(createBrowserClockWorker());
}
