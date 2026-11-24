import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '@capture/shared/clock';
import { CLOCK_CHECK_LIMIT_MS, runPreflight } from '../site/src/preflight.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';

// These run in Node, which has none of the browser features the other checks look for. That is
// fine here: the subject is the check of the worker clock, the one check that can hang.

/** @param {Awaited<ReturnType<typeof runPreflight>>} checks */
const clockCheck = (checks) => checks.find((check) => check.id === 'clock');

describe('preflight: worker clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('passes with a working clock, and disposes of it', async () => {
        const worker = createFakeClockWorker();
        const running = runPreflight({ createClock: () => new Clock(worker) });
        await vi.advanceTimersByTimeAsync(200);
        const checks = await running;
        expect(clockCheck(checks)).toMatchObject({ state: 'yes' });
        expect(worker.terminated).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        // The checks after the clock's still ran.
        expect(checks.map((check) => check.id)).toEqual(expect.arrayContaining(['loopback', 'extension']));
    });

    it('gives up on a worker that never answers, instead of waiting for ever', async () => {
        const worker = createFakeClockWorker();
        worker.postMessage = () => {}; // started, but silent
        let settled = false;
        const running = runPreflight({ createClock: () => new Clock(worker) }).then((checks) => {
            settled = true;
            return checks;
        });
        await vi.advanceTimersByTimeAsync(CLOCK_CHECK_LIMIT_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        const checks = await running;
        expect(clockCheck(checks)).toMatchObject({ state: 'no', detail: expect.stringContaining('did not answer within 5 s') });
        expect(worker.terminated).toBe(true);
        expect(checks.map((check) => check.id)).toContain('extension');
    });

    it('reports a worker that fails to start, without waiting out the limit', async () => {
        const worker = createFakeClockWorker();
        worker.postMessage = () => {
            queueMicrotask(() => worker.onerror?.({ message: 'refused by Content-Security-Policy' }));
        };
        const checks = await runPreflight({ createClock: () => new Clock(worker) });
        expect(clockCheck(checks)).toMatchObject({ state: 'no', detail: expect.stringContaining('refused by Content-Security-Policy') });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports a clock that cannot be created at all', async () => {
        const checks = await runPreflight({
            createClock: () => {
                throw new Error('Worker is not defined');
            },
        });
        expect(clockCheck(checks)).toMatchObject({ state: 'no', detail: expect.stringContaining('Worker is not defined') });
        expect(checks.map((check) => check.id)).toContain('extension');
    });
});
