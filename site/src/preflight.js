/**
 * Checks what this browser can do, so the page can say what will and will not
 * work before a test is attempted (docs/features.md, "Capability preflight").
 *
 * These are checks of the browser the page runs in. Checks of the browser
 * under test - which capture features it supports - belong to each runner.
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} label
 * @property {'yes' | 'no' | 'info'} state
 * @property {string} detail
 */

/**
 * @param {object} deps
 * @param {import('@capture/shared/clock').Clock} deps.clock
 * @returns {Promise<Check[]>}
 */
export async function runPreflight({ clock }) {
    /** @type {Check[]} */
    const checks = [];
    /**
     * @param {string} id
     * @param {string} label
     * @param {boolean} ok
     * @param {string} yes
     * @param {string} no
     */
    const has = (id, label, ok, yes, no) => checks.push({ id, label, state: ok ? 'yes' : 'no', detail: ok ? yes : no });

    has('secure-context', 'Secure context', globalThis.isSecureContext === true, 'The page is served securely.', 'Not a secure context; device access and storage will be unavailable.');
    has('webusb', 'WebUSB', 'usb' in navigator, 'Needed to reach an Android phone over USB.', 'Not available: the Android runner needs a Chromium-based desktop browser.');
    has('webcodecs', 'Video decoding', typeof globalThis.VideoDecoder === 'function', 'Needed to analyse recordings from a phone.', 'Not available: recordings from a phone cannot be analysed here.');
    has('streams', 'Compression streams', typeof globalThis.DecompressionStream === 'function' && typeof globalThis.CompressionStream === 'function', 'Used to read and write compressed traces.', 'Not available.');
    has('opfs', 'Private file storage', typeof navigator.storage?.getDirectory === 'function', 'Used to keep results in this browser.', 'Not available: results cannot be kept in this browser.');

    checks.push(await clockCheck(clock));
    checks.push(await loopbackCheck());
    checks.push({ id: 'extension', label: 'Extension', state: 'info', detail: 'Not checked yet: the extension runner has not been built.' });
    return checks;
}

/**
 * The clock that capture code waits on must not depend on page timers (RE-015).
 * @param {import('@capture/shared/clock').Clock} clock
 * @returns {Promise<Check>}
 */
async function clockCheck(clock) {
    const requested = 100;
    try {
        // One round trip first, so that starting the worker is not counted as lateness.
        await clock.timeout(clock.sleep(0), 5000, 'clock check');
        const started = performance.now();
        await clock.timeout(clock.sleep(requested), 5000, 'clock check');
        const late = Math.round(performance.now() - started - requested);
        return { id: 'clock', label: 'Worker clock', state: 'yes', detail: `A ${requested} ms wait finished ${late} ms late.` };
    } catch (error) {
        return { id: 'clock', label: 'Worker clock', state: 'no', detail: `Timing in the background will be unreliable: ${message(error)}` };
    }
}

/**
 * A public page may reach the local helper only after the user allows loopback access (RE-014).
 * @returns {Promise<Check>}
 */
async function loopbackCheck() {
    const label = 'Local helper access';
    try {
        const status = await navigator.permissions.query({ name: /** @type {PermissionName} */ ('loopback-network') });
        const detail = {
            granted: 'Allowed: this page may connect to a helper running on this computer.',
            prompt: 'Not asked yet: Chrome will ask for permission the first time the helper is used.',
            denied: 'Blocked: allow this site to access apps on this device in the site settings to use the helper.',
        }[status.state];
        return { id: 'loopback', label, state: status.state === 'granted' ? 'yes' : status.state === 'denied' ? 'no' : 'info', detail };
    } catch {
        return { id: 'loopback', label, state: 'info', detail: 'This browser does not report the permission the helper needs.' };
    }
}

/** @param {unknown} error */
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
