/**
 * The Chrome DevTools Protocol methods the capture pipeline may call, and the
 * URLs it may load.
 *
 * One list, used in three places: the pipeline (so it cannot grow a dependency
 * the relays would refuse), the extension's relay (D-018) and the helper's
 * relay (D-022). It exists because an unfiltered CDP relay is local-file read
 * for whoever is paired with it - demonstrated in docs/rough-edges.md RE-014.
 *
 * Adding a method here is a security change. Before adding one, ask what a
 * hostile page could do with it through the helper or the extension: reach
 * local files, read another site's data, change browser settings, download or
 * upload files. If the answer is "anything", it does not belong here.
 */

/** @type {ReadonlySet<string>} */
export const ALLOWED_METHODS = new Set([
    'Browser.getVersion',
    // This list checks names, not whose target an id is. A relay must also keep the two calls
    // that take a target id to targets it created itself (D-018; architecture.md 3.7).
    'Target.createTarget',
    'Target.attachToTarget',
    'Target.closeTarget',
    'Page.enable',
    'Page.navigate',
    'Page.getLayoutMetrics',
    'Page.startScreenRecording',
    'Page.stopScreenRecording',
    'Network.enable',
    'Network.emulateNetworkConditionsByRule',
    'Network.clearBrowserCache',
    // Network.clearBrowserCookies is deliberately absent: it deletes every cookie in the profile,
    // for every site, whichever tab it is sent through. In a user's own browser that is data loss
    // far beyond the test. It may only ever be reached through a path that carries the user's
    // explicit consent, held where the page cannot forge it (D-027).
    'Tracing.start',
    'Tracing.end',
    'IO.read',
    'IO.close',
    // Runs script in the page under test. Needed today for the orange cover (D-014), and by
    // scripted tests on every runner, which is why it is here for all three (D-031). It cannot
    // reach local files by itself: web content is not allowed to navigate to file: URLs. What it
    // can do is act as the user in a tab that has their cookies - the extension's normal-profile
    // fallback - so the integrity of the capture origin is what protects those sites.
    'Runtime.evaluate',
]);

/** Methods whose `url` parameter decides what gets loaded. */
const URL_METHODS = new Set(['Page.navigate', 'Target.createTarget']);

/**
 * May the pipeline load this URL in the browser under test?
 * Only web URLs and the blank page: never `file:`, `chrome:`, `data:` and the like.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isUrlAllowed(url) {
    if (typeof url !== 'string') return false;
    if (url === 'about:blank') return true;
    try {
        const { protocol } = new URL(url);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Decide whether a CDP command may be sent.
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 * @returns {string | null} `null` if allowed, otherwise the reason it is refused
 */
export function vetCommand(method, params) {
    if (!ALLOWED_METHODS.has(method)) return `CDP method not on the allowlist: ${method}`;
    if (URL_METHODS.has(method) && !isUrlAllowed(params?.url)) return `${method} may only load http(s) URLs or about:blank`;
    return null;
}
