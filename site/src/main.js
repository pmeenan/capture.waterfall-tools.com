import { createClock } from '@capture/shared/clock';
import { runPreflight } from './preflight.js';
import { wireHelper } from './helper-ui.js';
import { wireRunPanel } from './run-ui.js';
import { DiagnosticsLog } from './diagnostics.js';
import { buildSampleResult } from './sample.js';
import { SITE_VERSION } from './version.js';

/** The three runners of the first release (docs/plan.md). The helper's card shows its live connection state. */
const RUNNERS = [
    { id: 'helper', title: 'Local helper', text: 'A dedicated Chrome on this computer, started by a small helper you run. The most complete capture.', status: 'Being built' },
    { id: 'android', title: 'Android phone', text: 'Chrome on a phone connected by USB, with no app to install.', status: 'Not built yet' },
    { id: 'extension', title: 'This browser', text: 'A tab in this browser, through an extension.', status: 'Not built yet' },
];

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{text?: string, className?: string}} [options]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, { text, className } = {}, children = []) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    node.append(...children);
    return node;
}

/** @param {string} id */
function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`missing element #${id}`);
    return node;
}

function renderRunners() {
    byId('runners').replaceChildren(...RUNNERS.map((r) => {
        const status = el('p', { text: r.status, className: 'status' });
        status.id = `${r.id}-status`;
        const actions = el('div', { className: 'runner-actions' });
        actions.id = `${r.id}-actions`;
        return el('li', { className: 'featureCard' }, [el('h3', { text: r.title }), el('p', { text: r.text }), status, actions]);
    }));
}

/** The diagnostics log of this page: preflight and every run, in memory until the user saves it. */
const log = new DiagnosticsLog();

async function renderPreflight() {
    const words = { yes: 'Yes', no: 'No', info: 'Note' };
    const checks = await runPreflight({ createClock });
    for (const check of checks) log.info(`preflight ${check.id}: ${check.state} - ${check.detail}`);
    byId('preflight').replaceChildren(
        ...checks.map((check) => {
            const state = el('span', { text: words[check.state], className: 'state' });
            state.dataset.state = check.state;
            const item = el('li', {}, [state, el('span', {}, [check.label, el('span', { text: check.detail, className: 'detail' })])]);
            item.dataset.check = check.id;
            return item;
        }),
    );
}

/** @type {string | null} */
let lastDownloadUrl = null;

function wireSample() {
    const button = /** @type {HTMLButtonElement} */ (byId('build-sample'));
    const output = byId('sample-output');
    button.addEventListener('click', async () => {
        button.disabled = true;
        output.replaceChildren(el('p', { text: 'Building…' }));
        try {
            const { blob, filename, manifest, traceEvents } = await buildSampleResult();
            if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
            lastDownloadUrl = URL.createObjectURL(blob);
            const link = el('a', { text: `Download ${filename}` });
            link.href = lastDownloadUrl;
            link.download = filename;
            /** @type {[string, string][]} */
            const facts = [
                ['Size', `${blob.size.toLocaleString()} bytes`],
                ['Format', `${manifest.format} ${manifest.formatVersion} (provisional)`],
                ['Tested URL', manifest.test.url],
                ['Runs', String(manifest.runs.length)],
                ['Trace', `${manifest.runs[0].files.trace}, ${traceEvents.toLocaleString()} events`],
            ];
            const result = el('div', { className: 'result' }, [el('dl', {}, facts.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })])), link]);
            result.dataset.built = 'true';
            output.replaceChildren(result);
        } catch (error) {
            output.replaceChildren(el('p', { text: `Could not build the sample: ${error instanceof Error ? error.message : String(error)}`, className: 'error' }));
        } finally {
            button.disabled = false;
        }
    });
}

// Read the helper's pairing link first: it is taken out of the address bar before anything else.
/** The "Save diagnostics log" button: the log leaves the machine only if the user saves it. */
function wireDiagnostics() {
    /** @type {string | null} */
    let url = null;
    byId('save-diagnostics').addEventListener('click', () => {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([log.toText({ version: SITE_VERSION })], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `capture-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
        link.click();
    });
}

byId('version').textContent = SITE_VERSION;
renderRunners();
log.info(`page loaded: Capture ${SITE_VERSION}`);
wireHelper({
    status: byId('helper-status'),
    actions: byId('helper-actions'),
    createClock,
    log,
    onPaired: (connection, clock) => wireRunPanel({ connection, clock, log, byId }),
});
wireDiagnostics();
wireSample();
renderPreflight().catch((error) => {
    byId('preflight').replaceChildren(el('li', { text: `Checks failed: ${error instanceof Error ? error.message : String(error)}`, className: 'error' }));
});
