/**
 * The "Run a test" panel: a URL, a browser, Run and Cancel, each step as it starts, then the
 * outcome, the result zip to save, and the result in the embedded viewer. Shown once the helper is
 * paired; every step and error also goes to the diagnostics log.
 */

import { runWithHelper } from './capture/helper-run.js';
import { ENDING } from './capture/page-load.js';
import { showInViewer, viewerOrigin } from './viewer-embed.js';
import { SITE_VERSION } from './version.js';

/** @type {Record<string, string>} */
const ENDING_WORDS = {
    [ENDING.completed]: 'Completed: the page loaded and the network went quiet.',
    [ENDING.timedOut]: 'Timed out: the page was still busy after 120 seconds. What was captured is kept.',
    [ENDING.navigationFailed]: 'The page could not be loaded',
    [ENDING.cancelled]: 'Cancelled. What was captured up to then is kept.',
};

/**
 * @param {object} deps
 * @param {import('./helper-connection.js').HelperConnection} deps.connection
 * @param {import('@capture/shared/clock').Clock} deps.clock
 * @param {import('./diagnostics.js').DiagnosticsLog} deps.log
 * @param {(id: string) => HTMLElement} deps.byId
 */
export function wireRunPanel({ connection, clock, log, byId }) {
    const panel = byId('run-panel');
    const form = /** @type {HTMLFormElement} */ (byId('run-form'));
    const urlInput = /** @type {HTMLInputElement} */ (byId('run-url'));
    const browserSelect = /** @type {HTMLSelectElement} */ (byId('run-browser'));
    const start = /** @type {HTMLButtonElement} */ (byId('run-start'));
    const cancel = /** @type {HTMLButtonElement} */ (byId('run-cancel'));
    const steps = byId('run-steps');
    const output = byId('run-output');
    const viewer = byId('viewer');

    browserSelect.replaceChildren(...connection.browsers.map((b) => {
        const option = document.createElement('option');
        option.value = b.channel;
        option.textContent = `Chrome ${b.channel}`;
        return option;
    }));
    panel.hidden = false;

    /** @type {AbortController | null} */
    let running = null;
    /** @type {string | null} */
    let downloadUrl = null;

    cancel.addEventListener('click', () => {
        if (!running) return;
        log.step('cancel requested');
        running.abort();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (running) return;
        const url = normalizeUrl(urlInput.value);
        if (!url) {
            output.replaceChildren(paragraph('Enter an http or https address to test.', 'error'));
            return;
        }
        running = new AbortController();
        setBusy(true);
        steps.replaceChildren();
        output.replaceChildren();
        viewer.replaceChildren();
        log.info(`run: ${url} in Chrome ${browserSelect.value}`);
        try {
            const result = await runWithHelper({
                host: connection,
                clock,
                url,
                channel: browserSelect.value,
                signal: running.signal,
                generator: { name: 'capture.waterfall-tools.com', version: SITE_VERSION },
                onStep: (step) => {
                    log.step(step);
                    const item = document.createElement('li');
                    item.textContent = step;
                    steps.append(item);
                },
            });
            const { ending, timings } = result.load;
            log.info(`run ended: ${ending.reason}${ending.detail ? ` (${ending.detail})` : ''} at ${Math.round(timings.endMs)} ms`);
            showOutcome(result, url);
            if (ending.reason !== ENDING.navigationFailed) {
                const embed = document.createElement('p');
                embed.textContent = `Opening the result in the viewer (${viewerOrigin()})…`;
                output.append(embed);
                try {
                    await showInViewer({ container: viewer, clock, files: [{ name: 'trace.json.gz', data: result.load.trace }] });
                    embed.textContent = 'Shown in the viewer below. Nothing has left this computer.';
                    log.info('result shown in the viewer');
                } catch (error) {
                    embed.textContent = `Could not show it in the viewer: ${message(error)}`;
                    embed.className = 'error';
                    log.error('viewer', error);
                }
            }
        } catch (error) {
            log.error('run failed', error);
            output.replaceChildren(paragraph(`The run failed: ${message(error)}. Download the diagnostics log below if you want to report it.`, 'error'));
        } finally {
            running = null;
            setBusy(false);
        }
    });

    /** @param {boolean} busy */
    function setBusy(busy) {
        start.disabled = busy;
        urlInput.disabled = busy;
        browserSelect.disabled = busy;
        cancel.hidden = !busy;
    }

    /**
     * @param {import('./capture/helper-run.js').HelperRunResult} result
     * @param {string} url
     */
    function showOutcome(result, url) {
        const { ending, timings, document: doc } = result.load;
        let words = ENDING_WORDS[ending.reason] ?? ending.reason;
        if (ending.reason === ENDING.navigationFailed) words = `${words}: ${ending.detail ?? 'unknown error'}.`;
        if (downloadUrl) URL.revokeObjectURL(downloadUrl);
        downloadUrl = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (result.zip)], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName(url);
        link.textContent = `Download ${link.download}`;
        /** @type {[string, string][]} */
        const facts = [
            ['Outcome', words],
            ['Browser', result.browser],
            ['Page', doc.finalUrl === doc.url ? doc.url : `${doc.url} → ${doc.finalUrl}`],
            ['Status', doc.status === null ? '—' : String(doc.status)],
            ['Load event', timings.loadEventMs === null ? '—' : `${Math.round(timings.loadEventMs).toLocaleString()} ms`],
            ['Run ended', `${Math.round(timings.endMs).toLocaleString()} ms`],
            ['Requests', result.load.requests.length.toLocaleString()],
            ['Result', `${result.zip.length.toLocaleString()} bytes`],
        ];
        const list = document.createElement('dl');
        for (const [term, value] of facts) {
            const dt = document.createElement('dt');
            dt.textContent = term;
            const dd = document.createElement('dd');
            dd.textContent = value;
            list.append(dt, dd);
        }
        const box = document.createElement('div');
        box.className = 'result';
        box.dataset.ending = ending.reason;
        box.append(list, link);
        output.replaceChildren(box);
    }
}

/**
 * Accept what people type: a bare host gets https://. Only http and https are tested.
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
    const text = raw.trim();
    if (!text) return null;
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

/** @param {string} url */
function fileName(url) {
    const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `capture-${host}-${stamp}.zip`;
}

/** @param {string} text @param {string} [className] */
function paragraph(text, className) {
    const p = document.createElement('p');
    p.textContent = text;
    if (className) p.className = className;
    return p;
}

/** @param {unknown} error */
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
