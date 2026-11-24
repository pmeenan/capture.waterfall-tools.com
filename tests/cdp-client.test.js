import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CdpClient, CdpError } from '@capture/shared/cdp-client';
import { Clock, TimeoutError } from '@capture/shared/clock';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';

/** A transport that records what was sent and lets the test play the browser. */
function createFakeTransport() {
    /** @type {import('@capture/shared/cdp-client').CdpTransport & {sent: any[], closed: boolean, reply(message: object): void}} */
    const transport = {
        sent: [],
        closed: false,
        onMessage: null,
        onClose: null,
        send(text) {
            transport.sent.push(JSON.parse(text));
        },
        close() {
            transport.closed = true;
        },
        reply(message) {
            transport.onMessage?.(JSON.stringify(message));
        },
    };
    return transport;
}

describe('CdpClient', () => {
    /** @type {ReturnType<typeof createFakeTransport>} */
    let transport;
    /** @type {CdpClient} */
    let cdp;
    /** @type {Clock} */
    let clock;

    beforeEach(() => {
        vi.useFakeTimers();
        transport = createFakeTransport();
        clock = new Clock(createFakeClockWorker());
        cdp = new CdpClient(transport, { clock });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sends a command and resolves with its result', async () => {
        const result = cdp.send('Browser.getVersion');
        expect(transport.sent).toEqual([{ id: 1, method: 'Browser.getVersion', params: {} }]);
        transport.reply({ id: 1, result: { product: 'Chrome/160.0.0.0' } });
        await expect(result).resolves.toEqual({ product: 'Chrome/160.0.0.0' });
    });

    it('carries the session id when given one', () => {
        cdp.send('Page.enable', {}, 'SESSION');
        expect(transport.sent[0]).toEqual({ id: 1, method: 'Page.enable', params: {}, sessionId: 'SESSION' });
    });

    it('matches replies to commands by id, in any order', async () => {
        const first = cdp.send('Page.enable');
        const second = cdp.send('Network.enable');
        transport.reply({ id: 2, result: { which: 'second' } });
        transport.reply({ id: 1, result: { which: 'first' } });
        await expect(first).resolves.toEqual({ which: 'first' });
        await expect(second).resolves.toEqual({ which: 'second' });
    });

    it('rejects with the browser error', async () => {
        const result = cdp.send('Page.startScreenRecording');
        transport.reply({ id: 1, error: { code: -32000, message: 'Video recording is not supported without AV1/libaom enabled.' } });
        await expect(result).rejects.toMatchObject({ name: 'CdpError', method: 'Page.startScreenRecording', code: -32000 });
    });

    it('refuses a method off the allowlist without sending it', async () => {
        await expect(cdp.send('DOM.setFileInputFiles', { files: ['C:/secret.txt'] })).rejects.toBeInstanceOf(CdpError);
        expect(transport.sent).toHaveLength(0);
    });

    it('refuses to navigate to a local file without sending it', async () => {
        await expect(cdp.send('Page.navigate', { url: 'file:///C:/secret.txt' })).rejects.toThrow(/may only load/);
        expect(transport.sent).toHaveLength(0);
    });

    it('delivers events to listeners until they unsubscribe', () => {
        const seen = vi.fn();
        const off = cdp.onEvent(seen);
        transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'S' });
        off();
        transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 2 }, sessionId: 'S' });
        expect(seen).toHaveBeenCalledTimes(1);
        expect(seen).toHaveBeenCalledWith({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'S' });
    });

    it('waitFor resolves on the matching event only', async () => {
        const waiting = cdp.waitFor('Page.loadEventFired', { sessionId: 'S', predicate: (p) => p.timestamp > 5 });
        transport.reply({ method: 'Page.frameNavigated', params: {}, sessionId: 'S' });
        transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 9 }, sessionId: 'OTHER' });
        transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 3 }, sessionId: 'S' });
        transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 7 }, sessionId: 'S' });
        await expect(waiting).resolves.toEqual({ timestamp: 7 });
    });

    it('waitFor times out on the worker-backed clock', async () => {
        const waiting = cdp.waitFor('Page.loadEventFired', { timeoutMs: 500 });
        const assertion = expect(waiting).rejects.toBeInstanceOf(TimeoutError);
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
    });

    it('rejects everything still waiting when the transport closes', async () => {
        const pending = cdp.send('Tracing.end');
        transport.onClose?.();
        await expect(pending).rejects.toThrow('CDP connection closed');
        expect(cdp.closed).toBe(true);
        await expect(cdp.send('Page.enable')).rejects.toThrow('CDP connection closed');
    });

    it('close() closes the transport and rejects what is waiting', async () => {
        const pending = cdp.send('Tracing.end');
        cdp.close();
        await expect(pending).rejects.toThrow('CDP connection closed');
        expect(transport.closed).toBe(true);
    });

    it('ignores malformed and unknown messages', () => {
        expect(() => transport.onMessage?.('not json')).not.toThrow();
        expect(() => transport.reply({ id: 999, result: {} })).not.toThrow();
        expect(() => transport.reply({})).not.toThrow();
    });

    it.each(['null', '42', '"text"', 'true', '[]'])('ignores the valid but meaningless JSON message %s', (text) => {
        expect(() => transport.onMessage?.(text)).not.toThrow();
    });

    it('releases its timer and listener when a wait is satisfied', async () => {
        const waiting = cdp.waitFor('Page.loadEventFired');
        expect(clock.pending).toBe(1);
        transport.reply({ method: 'Page.loadEventFired', params: {} });
        await waiting;
        expect(clock.pending).toBe(0);
    });

    // An event wait must not outlive the connection: unplugging a phone or cancelling a run
    // has to let cleanup proceed at once, not after a 30 second timeout (or never).
    it('rejects an event wait when the transport closes, and releases its timer', async () => {
        const waiting = cdp.waitFor('Tracing.tracingComplete');
        const assertion = expect(waiting).rejects.toThrow('CDP connection closed');
        transport.onClose?.();
        await assertion;
        expect(clock.pending).toBe(0);
    });

    it('rejects an event wait on close(), even if the clock is disposed afterwards', async () => {
        const waiting = cdp.waitFor('Tracing.tracingComplete');
        const assertion = expect(waiting).rejects.toMatchObject({ name: 'CdpError', method: 'Tracing.tracingComplete' });
        cdp.close();
        clock.dispose();
        await assertion;
    });

    it('refuses to start a wait on a closed connection', async () => {
        cdp.close();
        await expect(cdp.waitFor('Page.loadEventFired')).rejects.toThrow('CDP connection closed');
        expect(clock.pending).toBe(0);
    });

    it('cancels an event wait through an abort signal', async () => {
        const controller = new AbortController();
        const waiting = cdp.waitFor('Page.loadEventFired', { signal: controller.signal });
        const assertion = expect(waiting).rejects.toThrow('was cancelled');
        controller.abort();
        await assertion;
        expect(clock.pending).toBe(0);
        // The event arriving later must not resurrect anything.
        expect(() => transport.reply({ method: 'Page.loadEventFired', params: {} })).not.toThrow();
    });

    it('rejects at once if the signal was already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(cdp.waitFor('Page.loadEventFired', { signal: controller.signal })).rejects.toThrow('was cancelled');
        expect(clock.pending).toBe(0);
    });

    it('settles a wait only once when the event and the close race', async () => {
        const waiting = cdp.waitFor('Page.loadEventFired');
        transport.reply({ method: 'Page.loadEventFired', params: { first: true } });
        transport.onClose?.();
        await expect(waiting).resolves.toEqual({ first: true });
    });

    it('rejects a command, and forgets it, when the transport throws on send', async () => {
        transport.send = () => {
            throw new Error('socket is closing');
        };
        await expect(cdp.send('Browser.getVersion')).rejects.toThrow('socket is closing');
        // Nothing is left waiting: closing has no command to reject, so it must not throw or hang.
        cdp.close();
        expect(clock.pending).toBe(0);
    });

    it('times a command out when asked to, and drops the late answer', async () => {
        const result = cdp.send('Tracing.end', {}, undefined, { timeoutMs: 5000 });
        const assertion = expect(result).rejects.toThrow(new TimeoutError('Tracing.end timed out after 5000 ms'));
        await vi.advanceTimersByTimeAsync(5000);
        await assertion;
        expect(() => transport.reply({ id: 1, result: {} })).not.toThrow();
        expect(clock.pending).toBe(0);
    });

    it('leaves no timer behind when a timed command is answered', async () => {
        const result = cdp.send('Browser.getVersion', {}, undefined, { timeoutMs: 5000 });
        transport.reply({ id: 1, result: { product: 'Chrome' } });
        await expect(result).resolves.toEqual({ product: 'Chrome' });
        expect(clock.pending).toBe(0);
    });

    it('cancels a command through an abort signal', async () => {
        const controller = new AbortController();
        const result = cdp.send('Tracing.end', {}, undefined, { signal: controller.signal, timeoutMs: 5000 });
        const assertion = expect(result).rejects.toThrow('Tracing.end was cancelled');
        controller.abort();
        await assertion;
        expect(clock.pending).toBe(0);
        await expect(cdp.send('Tracing.end', {}, undefined, { signal: controller.signal })).rejects.toThrow('was cancelled');
        expect(transport.sent).toHaveLength(1);
    });

    it('delivers an event to the other listeners when one throws', async () => {
        const errors = vi.fn();
        cdp = new CdpClient(transport, { clock, onListenerError: errors });
        cdp.onEvent(() => {
            throw new Error('listener bug');
        });
        const waiting = cdp.waitFor('Page.loadEventFired');
        expect(() => transport.reply({ method: 'Page.loadEventFired', params: { timestamp: 1 } })).not.toThrow();
        await expect(waiting).resolves.toEqual({ timestamp: 1 });
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0][0]).toMatchObject({ message: 'listener bug' });
    });

    it('fails a wait whose predicate throws, without disturbing other waits', async () => {
        const broken = cdp.waitFor('Page.loadEventFired', {
            predicate: () => {
                throw new Error('predicate bug');
            },
        });
        const fine = cdp.waitFor('Page.loadEventFired');
        const assertion = expect(broken).rejects.toThrow('predicate bug');
        transport.reply({ method: 'Page.loadEventFired', params: {} });
        await assertion;
        await expect(fine).resolves.toEqual({});
        expect(clock.pending).toBe(0);
    });

    it('ends waits and timed commands when the clock stops, since their timeouts can no longer fire', async () => {
        const waiting = expect(cdp.waitFor('Page.loadEventFired')).rejects.toThrow('disposed');
        const command = expect(cdp.send('Tracing.end', {}, undefined, { timeoutMs: 5000 })).rejects.toThrow('disposed');
        clock.dispose();
        await waiting;
        await command;
        await expect(cdp.waitFor('Page.loadEventFired')).rejects.toThrow('disposed');
    });
});
