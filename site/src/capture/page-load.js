/**
 * One page load, from attach to a collected trace (architecture §3.4, steps 5-11 and 14), ended by
 * the rule of D-028:
 *   - ends once the load event has fired and then no request has been in flight for QUIET_MS;
 *   - WebSockets, event streams, and requests open longer than LONG_REQUEST_MS do not count;
 *   - TIME_LIMIT_MS from the start of navigation ends it as timed out;
 *   - a failed navigation (the main document could not be loaded) ends it at once;
 *   - every ending, cancellation included, keeps what was captured, and is recorded.
 *
 * Runner-agnostic: it talks to the browser only through a CdpClient, whose commands are vetted
 * against the shared allowlist, and it uses no DOM or Node API, so the same code runs in the page
 * and in Node tests. Every wait is on the worker-backed clock, never a page timer (RE-015).
 */

export const QUIET_MS = 2000;
export const LONG_REQUEST_MS = 10000;
export const TIME_LIMIT_MS = 120000;
/** How often the end-of-load condition is re-checked. Timing comes from events, not from this. */
const POLL_MS = 100;

/** How a run ended (D-028). */
export const ENDING = Object.freeze({
    completed: 'completed',
    timedOut: 'timed-out',
    navigationFailed: 'navigation-failed',
    cancelled: 'cancelled',
});

/** Trace categories for a browser-level trace: timeline, loading, user timing, and NetLog events. */
export const TRACE_CATEGORIES = Object.freeze([
    '-*',
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'blink.user_timing',
    'loading',
    'netlog',
    'disabled-by-default-netlog',
    'toplevel',
    'v8.execute',
]);

/** Resource types that never hold a run open. */
const STREAMING_TYPES = new Set(['WebSocket', 'EventSource']);

/**
 * @typedef {object} CapturedRequest
 * @property {string} url as requested, before any redirect; redirects appear as their own entries
 * @property {string} type CDP resource type
 * @property {number} startMs from the start of navigation
 * @property {number} [endMs]
 * @property {number} [status]
 * @property {string} [error]
 * @property {boolean} [fromCache]
 */

/**
 * @typedef {object} PageLoadResult
 * @property {{reason: string, detail?: string}} ending
 * @property {{loadEventMs: number | null, endMs: number}} timings from the start of navigation
 * @property {{url: string, finalUrl: string, status: number | null}} document
 * @property {CapturedRequest[]} requests every request seen, in order
 * @property {Uint8Array} trace gzipped Chrome trace JSON
 */

/**
 * @param {object} options
 * @param {import('@capture/shared/cdp-client').CdpClient} options.client a client on a browser-level connection
 * @param {import('@capture/shared/clock').Clock} options.clock
 * @param {string} options.url
 * @param {AbortSignal} [options.signal] cancels the run; what was captured is still collected
 * @param {number} [options.timeLimitMs] D-028's limit; only tests shorten it
 * @param {() => number} [options.now]
 * @param {(step: string) => void} [options.onStep] each step as it starts, for progress and the diagnostics log
 * @returns {Promise<PageLoadResult>}
 */
export async function runPageLoad({ client, clock, url, signal, timeLimitMs = TIME_LIMIT_MS, now = () => performance.now(), onStep = () => {} }) {
    onStep('open a tab');
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    try {
        await client.send('Page.enable', {}, sessionId);
        await client.send('Network.enable', {}, sessionId);

        onStep('start the trace');
        await client.send('Tracing.start', {
            traceConfig: { includedCategories: [...TRACE_CATEGORIES], recordMode: 'recordAsMuchAsPossible' },
            transferMode: 'ReturnAsStream',
            streamCompression: 'gzip',
        });

        const state = trackLoad({ client, sessionId, now });
        let result;
        try {
            onStep('navigate');
            result = await waitForEnd({ client, clock, sessionId, url, signal, timeLimitMs, now, state });
        } finally {
            state.stop();
        }

        onStep('collect the trace');
        const trace = await collectTrace(client);
        return { ...result, requests: state.requests, trace };
    } finally {
        onStep('close the tab');
        await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
}

/**
 * Follow the network and the load event of one tab.
 * @param {{client: import('@capture/shared/cdp-client').CdpClient, sessionId: string, now: () => number}} options
 */
function trackLoad({ client, sessionId, now }) {
    let origin = now();
    /** Requests in flight, by request id: a redirect reuses the id, so a counter would drift. */
    /** @type {Map<string, {startMs: number, type: string, streaming: boolean, entry: CapturedRequest}>} */
    const open = new Map();
    /** @type {CapturedRequest[]} */
    const requests = [];
    /** The latest hop of every request, by id, kept after it finishes. Events about the document
     *  can arrive before Page.navigate returns its id, so the document is looked up here later. */
    /** @type {Map<string, CapturedRequest>} */
    const byId = new Map();
    let navigating = false;
    const state = {
        requests,
        open,
        byId,
        /** @type {number | null} */ loadEventMs: null,
        /** When the last counted request finished, from the start of navigation. */
        lastFinishMs: 0,
        /** The main document's request id: Page.navigate's loaderId. */
        /** @type {string | null} */ documentId: null,
        /** Start the clock at navigation. */
        markNavigation() { origin = now(); navigating = true; },
        elapsed() { return now() - origin; },
        stop() { unsubscribe(); },
        /** The main document's latest hop, once its id is known. */
        document() { return state.documentId === null ? undefined : byId.get(state.documentId); },
    };

    /** @param {string} id @param {{error?: string}} [how] */
    const finish = (id, how = {}) => {
        const request = open.get(id);
        if (!request) return;
        open.delete(id);
        request.entry.endMs = state.elapsed();
        if (how.error) request.entry.error = how.error;
        if (!request.streaming) state.lastFinishMs = Math.max(state.lastFinishMs, request.entry.endMs);
    };

    const unsubscribe = client.onEvent(({ method, params, sessionId: from }) => {
        if (from !== sessionId) return;
        switch (method) {
            case 'Network.requestWillBeSent': {
                const requestUrl = String(params.request?.url ?? '');
                // data: and blob: URLs never reach the network and may never report an end.
                if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return;
                const existing = open.get(params.requestId);
                if (existing && params.redirectResponse) {
                    // The same id continues after a redirect: close the hop, open the next one.
                    existing.entry.status = params.redirectResponse.status;
                    existing.entry.endMs = state.elapsed();
                }
                /** @type {CapturedRequest} */
                const entry = { url: requestUrl, type: String(params.type ?? 'Other'), startMs: state.elapsed() };
                requests.push(entry);
                byId.set(params.requestId, entry);
                open.set(params.requestId, {
                    startMs: existing?.startMs ?? entry.startMs,
                    type: entry.type,
                    streaming: STREAMING_TYPES.has(entry.type),
                    entry,
                });
                return;
            }
            case 'Network.requestServedFromCache': {
                const request = open.get(params.requestId);
                if (request) request.entry.fromCache = true;
                finish(params.requestId);
                return;
            }
            case 'Network.responseReceived': {
                const request = open.get(params.requestId);
                if (!request) return;
                request.entry.status = params.response?.status;
                // An event stream fetched as an ordinary request is recognised by its response.
                if (String(params.response?.mimeType ?? '').toLowerCase() === 'text/event-stream') request.streaming = true;
                return;
            }
            case 'Network.loadingFinished':
                finish(params.requestId);
                return;
            case 'Network.loadingFailed':
                // A cancelled request is not an error: ERR_ABORTED on the document is usually the
                // page replacing its own navigation, and on a subresource only a cancellation.
                finish(params.requestId, params.canceled || params.errorText === 'net::ERR_ABORTED' ? {} : { error: String(params.errorText ?? 'failed') });
                return;
            case 'Page.loadEventFired':
                if (navigating && state.loadEventMs === null) state.loadEventMs = state.elapsed();
                return;
            default:
        }
    });
    return state;
}

/**
 * Navigate, then wait until D-028 says the load is over.
 * @param {object} o
 * @param {import('@capture/shared/cdp-client').CdpClient} o.client
 * @param {import('@capture/shared/clock').Clock} o.clock
 * @param {string} o.sessionId
 * @param {string} o.url
 * @param {AbortSignal | undefined} o.signal
 * @param {number} o.timeLimitMs
 * @param {() => number} o.now
 * @param {ReturnType<typeof trackLoad>} o.state
 * @returns {Promise<Omit<PageLoadResult, 'requests' | 'trace'>>}
 */
async function waitForEnd({ client, clock, sessionId, url, signal, timeLimitMs, state }) {
    /** @param {string} reason @param {string} [detail] */
    const end = (reason, detail) => {
        const doc = state.document();
        return {
            ending: detail ? { reason, detail } : { reason },
            timings: { loadEventMs: state.loadEventMs, endMs: state.elapsed() },
            document: { url, finalUrl: doc?.url ?? url, status: doc?.status ?? null },
        };
    };

    state.markNavigation();
    if (signal?.aborted) return end(ENDING.cancelled);
    const navigation = await client.send('Page.navigate', { url }, sessionId);
    state.documentId = navigation.loaderId ?? null;
    if (navigation.errorText && navigation.errorText !== 'net::ERR_ABORTED') return end(ENDING.navigationFailed, navigation.errorText);

    for (;;) {
        if (signal?.aborted) return end(ENDING.cancelled);
        const documentError = state.document()?.error;
        if (documentError) return end(ENDING.navigationFailed, documentError);
        const t = state.elapsed();
        if (t >= timeLimitMs) return end(ENDING.timedOut);
        if (state.loadEventMs !== null) {
            let counted = 0;
            let longCutoffMs = 0;
            for (const request of state.open.values()) {
                if (request.streaming) continue;
                if (t - request.startMs > LONG_REQUEST_MS) {
                    longCutoffMs = Math.max(longCutoffMs, request.startMs + LONG_REQUEST_MS);
                    continue;
                }
                counted++;
            }
            if (counted === 0) {
                // Quiet since the latest of: the load event, the last counted request finishing,
                // and the moment a still-open request stopped counting by passing the 10 s mark.
                const quietSince = Math.max(state.loadEventMs, state.lastFinishMs, longCutoffMs);
                if (t - quietSince >= QUIET_MS) return end(ENDING.completed);
            }
        }
        await clock.sleep(POLL_MS);
    }
}

/**
 * End the trace and read it back through IO.read.
 * @param {import('@capture/shared/cdp-client').CdpClient} client
 * @returns {Promise<Uint8Array>}
 */
async function collectTrace(client) {
    const complete = client.waitFor('Tracing.tracingComplete', { timeoutMs: 60000 });
    await client.send('Tracing.end');
    const { stream } = await complete;
    /** @type {Uint8Array[]} */
    const parts = [];
    let total = 0;
    try {
        for (;;) {
            const chunk = await client.send('IO.read', { handle: stream, size: 1 << 20 });
            const bytes = chunk.base64Encoded ? base64ToBytes(chunk.data) : new TextEncoder().encode(chunk.data);
            parts.push(bytes);
            total += bytes.length;
            if (chunk.eof) break;
        }
    } finally {
        await client.send('IO.close', { handle: stream }).catch(() => {});
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/** @param {string} b64 */
function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
