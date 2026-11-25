// The page-load pipeline (site/src/capture/page-load.js) against real Chrome and the controlled
// test pages: every ending D-028 defines, timed where the rule says it should be, with exactly the
// requests each page makes. One headless Chrome, launched on the pipe the way the helper launches
// it, serves every case; each case opens its own tab. Skipped where no Chrome is installed.
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CdpClient } from '@capture/shared/cdp-client';
import { ALLOWED_METHODS, vetCommand } from '@capture/shared/cdp-allowlist';
import { Clock } from '@capture/shared/clock';
import { findBrowsers, launchBrowser } from '../helper/src/chrome.js';
import { ENDING, LONG_REQUEST_MS, QUIET_MS, runPageLoad } from '../site/src/capture/page-load.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';
import { startTestPages } from './helpers/test-pages.js';

const chrome = findBrowsers()[0];
/** How far past the rule's moment a run may end: the 100 ms poll plus event delivery. */
const SLACK_MS = 700;

describe.skipIf(!chrome)('page-load pipeline against real Chrome', () => {
    /** @type {import('../helper/src/chrome.js').LaunchedBrowser} */
    let browser;
    /** @type {CdpClient} */
    let client;
    /** @type {Clock} */
    let clock;
    /** @type {import('./helpers/test-pages.js').TestPages} */
    let pages;
    /** Every command the pipeline sent, checked by the allowlist on the way. */
    /** @type {string[]} */
    const sent = [];

    beforeAll(async () => {
        pages = await startTestPages();
        browser = launchBrowser({ executable: chrome.path, headless: true });
        /** @type {import('@capture/shared/cdp-client').CdpTransport} */
        const transport = { send: (text) => browser.send(text), onMessage: null, onClose: null, close: () => {} };
        browser.onMessage((text) => transport.onMessage?.(text));
        clock = new Clock(createFakeClockWorker());
        client = new CdpClient(transport, {
            clock,
            vet: (method, params) => { sent.push(method); return vetCommand(method, params); },
        });
    }, 30000);

    afterAll(async () => {
        client?.close();
        clock?.dispose();
        await browser?.close();
        await pages?.close();
    });

    /** @param {string} url @param {Partial<Parameters<typeof runPageLoad>[0]>} [extra] */
    const load = (url, extra = {}) => {
        pages.clearLog();
        return runPageLoad({ client, clock, url, ...extra });
    };
    /** Paths the pipeline saw, as the server would log them. */
    const capturedPaths = (/** @type {import('../site/src/capture/page-load.js').PageLoadResult} */ r) =>
        r.requests.map((q) => { const u = new URL(q.url); return `${u.pathname}${u.search}`; });

    it('completes a simple page 2 s after the load event, with exactly its requests and a trace', async () => {
        const r = await load(pages.url('/simple'));
        expect(r.ending).toEqual({ reason: ENDING.completed });
        expect(r.document).toMatchObject({ status: 200, finalUrl: pages.url('/simple') });
        expect(capturedPaths(r).sort()).toEqual([...pages.log].sort());
        expect(capturedPaths(r).sort()).toEqual(['/pixel.png', '/simple', '/simple.css', '/simple.js']);
        const quiet = r.timings.endMs - /** @type {number} */ (r.timings.loadEventMs);
        expect(quiet).toBeGreaterThanOrEqual(QUIET_MS);
        expect(quiet).toBeLessThan(QUIET_MS + SLACK_MS);
        const trace = JSON.parse(gunzipSync(r.trace).toString('utf8'));
        const events = Array.isArray(trace) ? trace : trace.traceEvents;
        expect(events.length).toBeGreaterThan(100);
        expect(events.some((/** @type {any} */ e) => e.cat?.includes('netlog'))).toBe(true);
    }, 30000);

    it('follows a redirect and records where it ended', async () => {
        const r = await load(pages.url('/redirect'));
        expect(r.ending.reason).toBe(ENDING.completed);
        expect(r.document).toMatchObject({ url: pages.url('/redirect'), finalUrl: pages.url('/simple'), status: 200 });
        expect(capturedPaths(r)[0]).toBe('/redirect');
        expect(r.requests[0].status).toBe(302);
        expect(capturedPaths(r).sort()).toEqual([...pages.log].sort());
    }, 30000);

    it('completes a page that arrives with an error status', async () => {
        const r = await load(pages.url('/not-found'));
        expect(r.ending.reason).toBe(ENDING.completed);
        expect(r.document.status).toBe(404);
    }, 30000);

    it('waits for a request made after the load event', async () => {
        const r = await load(pages.url('/late-fetch'));
        expect(r.ending.reason).toBe(ENDING.completed);
        const slow = r.requests.find((q) => q.url.includes('/slow'));
        expect(slow?.endMs).toBeDefined();
        const end = /** @type {number} */ (slow?.endMs) + QUIET_MS;
        expect(r.timings.endMs).toBeGreaterThanOrEqual(end);
        expect(r.timings.endMs).toBeLessThan(end + SLACK_MS);
    }, 30000);

    it('is not held open by an event stream', async () => {
        const r = await load(pages.url('/event-stream'));
        expect(r.ending.reason).toBe(ENDING.completed);
        expect(r.requests.find((q) => q.url.endsWith('/sse'))?.type).toBe('EventSource');
        expect(r.timings.endMs - /** @type {number} */ (r.timings.loadEventMs)).toBeLessThan(QUIET_MS + SLACK_MS);
    }, 30000);

    it('stops counting a request after 10 s', async () => {
        const r = await load(pages.url('/hanging'));
        expect(r.ending.reason).toBe(ENDING.completed);
        const hang = r.requests.find((q) => q.url.endsWith('/hang'));
        expect(hang).toBeDefined();
        const end = /** @type {number} */ (hang?.startMs) + LONG_REQUEST_MS + QUIET_MS;
        expect(r.timings.endMs).toBeGreaterThanOrEqual(end);
        expect(r.timings.endMs).toBeLessThan(end + SLACK_MS);
    }, 40000);

    it('times out a page that never goes quiet, and keeps what it captured', async () => {
        const r = await load(pages.url('/never-quiet'), { timeLimitMs: 5000 });
        expect(r.ending.reason).toBe(ENDING.timedOut);
        expect(r.timings.endMs).toBeGreaterThanOrEqual(5000);
        expect(r.timings.endMs).toBeLessThan(5000 + SLACK_MS);
        expect(r.requests.filter((q) => q.url.includes('/tick')).length).toBeGreaterThan(3);
        expect(r.trace.length).toBeGreaterThan(0);
    }, 30000);

    it('ends a failed navigation at once', async () => {
        const url = await pages.closedPortUrl();
        const r = await load(url);
        expect(r.ending.reason).toBe(ENDING.navigationFailed);
        expect(r.ending.detail).toMatch(/ERR_CONNECTION_REFUSED/);
        expect(r.timings.endMs).toBeLessThan(3000);
        expect(r.trace.length).toBeGreaterThan(0);
    }, 30000);

    it('stops on cancel and still collects the trace', async () => {
        const controller = new AbortController();
        const started = load(pages.url('/hanging'), { signal: controller.signal });
        await clock.sleep(1500);
        controller.abort();
        const r = await started;
        expect(r.ending.reason).toBe(ENDING.cancelled);
        expect(r.timings.endMs).toBeLessThan(1500 + SLACK_MS);
        expect(r.trace.length).toBeGreaterThan(0);
    }, 30000);

    it('called nothing outside the allowlist', () => {
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((m) => !ALLOWED_METHODS.has(m))).toEqual([]);
    });
});
