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

    beforeEach(() => {
        vi.useFakeTimers();
        transport = createFakeTransport();
        cdp = new CdpClient(transport, { clock: new Clock(createFakeClockWorker()) });
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
});
