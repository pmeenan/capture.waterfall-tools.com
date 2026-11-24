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

/** How long the timer worker gets to answer before the check gives up on it. */
export const CLOCK_CHECK_LIMIT_MS = 5000;

/**
 * @param {object} deps
 * @param {() => import('@capture/shared/clock').Clock} deps.createClock makes the clock to test; the check disposes of it
 * @returns {Promise<Check[]>}
 */
export async function runPreflight({ createClock }) {
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

    checks.push(await clockCheck(createClock));
    checks.push(await loopbackCheck());
    checks.push({ id: 'extension', label: 'Extension', state: 'info', detail: 'Not checked yet: the extension runner has not been built.' });
    return checks;
}

/**
 * The clock that capture code waits on must not depend on page timers (RE-015).
 * @param {() => import('@capture/shared/clock').Clock} createClock
 * @returns {Promise<Check>}
 */
async function clockCheck(createClock) {
    const requested = 100;
    /** @type {import('@capture/shared/clock').Clock | null} */
    let clock = null;
    let cancelLimit = () => {};
    try {
        const tested = (clock = createClock());
        // The one page timer in capture code (AGENTS.md rule 6), and it has to be one: this is the
        // check of the worker clock itself, and a worker that never starts cannot time itself out.
        // A hidden page fires it late, which only delays a "no"; it cannot turn a "yes" into one.
        const limit = new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`the timer worker did not answer within ${CLOCK_CHECK_LIMIT_MS / 1000} s`)), CLOCK_CHECK_LIMIT_MS);
            cancelLimit = () => clearTimeout(timer);
        });
        const probe = (async () => {
            await tested.sleep(0); // one round trip first, so that starting the worker is not counted as lateness
            const started = performance.now();
            await tested.sleep(requested);
            return Math.round(performance.now() - started - requested);
        })();
        const late = await Promise.race([probe, limit]);
        return { id: 'clock', label: 'Worker clock', state: 'yes', detail: `A ${requested} ms wait finished ${late} ms late.` };
    } catch (error) {
        return { id: 'clock', label: 'Worker clock', state: 'no', detail: `Timing in the background will be unreliable: ${message(error)}` };
    } finally {
        cancelLimit();
        clock?.dispose();
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
