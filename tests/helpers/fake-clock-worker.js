import { CLOCK_WORKER_SOURCE } from '@capture/shared/clock';

/**
 * Runs the real worker source outside a worker, on the test's own timers, so
 * tests exercise the code that ships rather than a re-implementation of it.
 * Use with vitest's fake timers to control time.
 * @returns {import('@capture/shared/clock').ClockWorker & {terminated: boolean, posted: any[]}}
 */
export function createFakeClockWorker() {
    /** @type {ReturnType<typeof createFakeClockWorker>} */
    const worker = {
        onmessage: null,
        terminated: false,
        posted: [],
        postMessage(message) {
            worker.posted.push(message);
            if (!worker.terminated) inside({ data: message });
        },
        terminate() {
            worker.terminated = true;
        },
    };
    /** @param {{type: 'fire', id: number}} data */
    const postMessage = (data) => {
        if (!worker.terminated) worker.onmessage?.({ data });
    };
    /** @type {(event: {data: unknown}) => void} */
    const inside = new Function('postMessage', `let onmessage; ${CLOCK_WORKER_SOURCE}; return (event) => onmessage(event);`)(postMessage);
    return worker;
}
