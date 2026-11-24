import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Clock, ClockError, TimeoutError } from '@capture/shared/clock';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';

describe('Clock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires a callback after the delay, once', () => {
        const clock = new Clock(createFakeClockWorker());
        const fired = vi.fn();
        clock.after(100, fired);
        vi.advanceTimersByTime(99);
        expect(fired).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fired).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(fired).toHaveBeenCalledTimes(1);
        expect(clock.pending).toBe(0);
    });

    it('does not fire a cancelled timer, and tells the worker to drop it', () => {
        const worker = createFakeClockWorker();
        const clock = new Clock(worker);
        const fired = vi.fn();
        const cancel = clock.after(50, fired);
        cancel();
        cancel(); // cancelling twice is harmless
        vi.advanceTimersByTime(500);
        expect(fired).not.toHaveBeenCalled();
        expect(worker.posted.filter((m) => m.type === 'clear')).toHaveLength(1);
    });

    it('keeps separate timers apart', () => {
        const clock = new Clock(createFakeClockWorker());
        /** @type {string[]} */
        const order = [];
        clock.after(30, () => order.push('b'));
        clock.after(10, () => order.push('a'));
        clock.after(20, () => order.push('cancelled'))();
        vi.advanceTimersByTime(100);
        expect(order).toEqual(['a', 'b']);
    });

    it('sleep resolves after the delay', async () => {
        const clock = new Clock(createFakeClockWorker());
        let done = false;
        const sleeping = clock.sleep(200).then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(199);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await sleeping;
        expect(done).toBe(true);
    });

    it('timeout passes a value through and cancels its timer', async () => {
        const clock = new Clock(createFakeClockWorker());
        await expect(clock.timeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
        expect(clock.pending).toBe(0);
    });

    it('timeout passes a rejection through and cancels its timer', async () => {
        const clock = new Clock(createFakeClockWorker());
        await expect(clock.timeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
        expect(clock.pending).toBe(0);
    });

    it('timeout rejects with TimeoutError when time runs out', async () => {
        const clock = new Clock(createFakeClockWorker());
        const never = new Promise(() => {});
        const result = clock.timeout(never, 250, 'page load');
        const assertion = expect(result).rejects.toThrow(new TimeoutError('page load timed out after 250 ms'));
        await vi.advanceTimersByTimeAsync(250);
        await assertion;
    });

    it('treats a negative delay as zero', () => {
        const worker = createFakeClockWorker();
        new Clock(worker).after(-5, () => {});
        expect(worker.posted[0]).toMatchObject({ type: 'set', ms: 0 });
    });

    it('stops everything on dispose', () => {
        const worker = createFakeClockWorker();
        const clock = new Clock(worker);
        const fired = vi.fn();
        clock.after(10, fired);
        clock.dispose();
        vi.advanceTimersByTime(100);
        expect(fired).not.toHaveBeenCalled();
        expect(worker.terminated).toBe(true);
        expect(() => clock.after(1, fired)).toThrow('disposed');
    });

    it('rejects everything still waiting when it is disposed', async () => {
        const clock = new Clock(createFakeClockWorker());
        const sleeping = expect(clock.sleep(1000)).rejects.toThrow(ClockError);
        const timed = expect(clock.timeout(new Promise(() => {}), 1000)).rejects.toThrow('disposed');
        clock.dispose();
        await sleeping;
        await timed;
        expect(clock.pending).toBe(0);
        await expect(clock.sleep(1)).rejects.toThrow('disposed');
        await expect(clock.timeout(Promise.reject(new Error('unheard')), 1)).rejects.toThrow('disposed');
    });

    it('rejects everything still waiting when its worker fails, and stops the worker', async () => {
        const worker = createFakeClockWorker();
        const clock = new Clock(worker);
        const stopped = vi.fn();
        clock.after(1000, () => {}, stopped);
        const sleeping = expect(clock.sleep(1000)).rejects.toThrow('the timer worker failed: blocked by policy');
        worker.onerror?.({ message: 'blocked by policy' });
        await sleeping;
        expect(stopped).toHaveBeenCalledWith(expect.any(ClockError));
        expect(worker.terminated).toBe(true);
        expect(() => clock.after(1, () => {})).toThrow('the timer worker failed');
    });

    it('treats a message that cannot be read as a failed worker', async () => {
        const worker = createFakeClockWorker();
        const clock = new Clock(worker);
        const sleeping = expect(clock.sleep(1000)).rejects.toThrow(ClockError);
        worker.onmessageerror?.({});
        await sleeping;
    });
});
