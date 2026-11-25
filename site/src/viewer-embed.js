/**
 * Showing a result in the embedded waterfall-tools viewer (D-006, D-020, architecture §3.11), over
 * the viewer's postMessage load API (protocol 1, waterfall-tools src/viewer/embed-api.js).
 *
 * The openness of that API runs one way only: the viewer accepts results from any embedder, but
 * this page, which holds traces with cookies in them, posts only to the viewer's exact origin -
 * never '*'. In production that origin is fixed. Only a page served from a loopback host may point
 * at another viewer, so the viewer built from the submodule can be tried locally; an origin from
 * a URL parameter is never used anywhere else.
 */

export const PRODUCTION_VIEWER = 'https://waterfall-tools.com';
export const VIEWER_PROTOCOL = 1;
/** How long a framed viewer gets to say it is ready, and then to load the result. */
export const READY_LIMIT_MS = 30000;
export const LOAD_LIMIT_MS = 120000;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The viewer origin to use: production, unless this page runs on loopback and names another
 * loopback viewer with `?viewer=`.
 * @param {Location} [location]
 * @returns {string}
 */
export function viewerOrigin(location = globalThis.location) {
    if (!LOOPBACK_HOSTS.has(location.hostname)) return PRODUCTION_VIEWER;
    const requested = new URLSearchParams(location.search).get('viewer');
    if (!requested) return PRODUCTION_VIEWER;
    try {
        const url = new URL(requested);
        if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
    } catch {
        // not a URL: fall back to production
    }
    return PRODUCTION_VIEWER;
}

/**
 * Frame the viewer in `container` and show the files in it.
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {{name: string, data: Uint8Array}[]} options.files copied before posting; the caller keeps its bytes
 * @param {import('@capture/shared/clock').Clock} options.clock
 * @param {string} [options.origin]
 * @returns {Promise<HTMLIFrameElement>} once the viewer reports the result loaded
 */
export async function showInViewer({ container, files, clock, origin = viewerOrigin() }) {
    const frame = document.createElement('iframe');
    frame.className = 'viewer-frame';
    frame.title = 'Waterfall Tools viewer';
    frame.src = `${origin}/`;
    const requestId = crypto.randomUUID();

    /** @type {(value: string) => void} */
    let onReady = () => {};
    /** @type {(value: {type: string, error?: string}) => void} */
    let onReply = () => {};
    const ready = new Promise((resolve) => { onReady = resolve; });
    const replied = new Promise((resolve) => { onReply = resolve; });
    /** @param {MessageEvent} event */
    const listener = (event) => {
        // Only the frame we made, from the origin we chose.
        if (event.source !== frame.contentWindow || event.origin !== origin) return;
        const message = event.data;
        if (message?.protocol !== VIEWER_PROTOCOL) return;
        if (message.type === 'waterfall-tools:ready') onReady(message.type);
        else if ((message.type === 'waterfall-tools:loaded' || message.type === 'waterfall-tools:error') && message.requestId === requestId) onReply(message);
    };
    window.addEventListener('message', listener);
    container.replaceChildren(frame);
    try {
        await clock.timeout(ready, READY_LIMIT_MS, 'the viewer to start');
        const copies = files.map((f) => ({ name: f.name, data: f.data.slice().buffer }));
        /** @type {Window} */ (frame.contentWindow).postMessage(
            { type: 'waterfall-tools:load', protocol: VIEWER_PROTOCOL, requestId, files: copies },
            origin,
            copies.map((c) => c.data),
        );
        const reply = await clock.timeout(replied, LOAD_LIMIT_MS, 'the viewer to load the result');
        if (reply.type === 'waterfall-tools:error') throw new Error(`the viewer could not load the result (${reply.error ?? 'error'})`);
        return frame;
    } finally {
        window.removeEventListener('message', listener);
    }
}
