// A run that fails part-way (M2 exit criterion: "a failed run's diagnostics log can be downloaded
// and says which step failed"). A fake browser host refuses one command; the run must stop there,
// close the browser anyway, and the diagnostics log - fed the way run-ui.js feeds it - must end
// with the failing step followed by the error.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Clock } from '@capture/shared/clock';
import { runWithHelper } from '../site/src/capture/helper-run.js';
import { DiagnosticsLog } from '../site/src/diagnostics.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';

/**
 * A browser host whose CDP answers every command, except `failOn`, which gets a CDP error.
 * @param {string} failOn
 */
function fakeHost(failOn) {
    const record = { launched: false, closed: false };
    /** @type {import('../site/src/capture/helper-run.js').BrowserHost} */
    const host = {
        async launch() { record.launched = true; },
        cdpTransport() {
            /** @type {import('@capture/shared/cdp-client').CdpTransport} */
            const transport = {
                send(text) {
                    const m = JSON.parse(text);
                    /** @type {any} */
                    let reply = { id: m.id, result: {} };
                    if (m.method === failOn) reply = { id: m.id, error: { code: -32000, message: `${failOn} refused by the test` } };
                    else if (m.method === 'Browser.getVersion') reply.result = { product: 'Chrome/999' };
                    else if (m.method === 'Target.createTarget') reply.result = { targetId: 'T1' };
                    else if (m.method === 'Target.attachToTarget') reply.result = { sessionId: 'S1' };
                    queueMicrotask(() => transport.onMessage?.(JSON.stringify(reply)));
                },
                onMessage: null,
                onClose: null,
                close() {},
            };
            return transport;
        },
        async closeBrowser() { record.closed = true; return { netLog: null }; },
    };
    return { host, record };
}

describe('a run that fails part-way', () => {
    /** @type {Clock} */
    let clock;
    beforeEach(() => { clock = new Clock(createFakeClockWorker()); });
    afterEach(() => clock.dispose());

    it.each([
        ['Tracing.start', 'start the trace'],
        ['Page.navigate', 'navigate'],
        ['Target.createTarget', 'open a tab'],
    ])('stops at %s, closes the browser, and the log names the step', async (failOn, step) => {
        const { host, record } = fakeHost(failOn);
        const log = new DiagnosticsLog();
        const run = runWithHelper({
            host, clock, url: 'https://example.com/', channel: 'stable',
            generator: { name: 'test', version: '0' },
            onStep: (s) => log.step(s),
        });
        await expect(run).rejects.toThrow(`${failOn} refused by the test`);
        await run.catch((error) => log.error('run failed', error)); // what run-ui.js does
        expect(record.launched).toBe(true);
        expect(record.closed).toBe(true);

        const entries = log.entries;
        const lastSteps = entries.filter((e) => e.kind === 'step').map((e) => e.text);
        // The failing step is the last step started before cleanup began.
        const cleanup = new Set(['close the tab', 'close Chrome']);
        expect(lastSteps.filter((s) => !cleanup.has(s)).at(-1)).toBe(step);
        expect(lastSteps).toContain('close Chrome');
        expect(entries.at(-1)).toMatchObject({ kind: 'error', text: `run failed: ${failOn} refused by the test` });
        const text = log.toText({ version: 'test' });
        expect(text).toMatch(new RegExp(`step\\s+${step}`));
        expect(text).toMatch(/error\s+run failed/);
    });
});
