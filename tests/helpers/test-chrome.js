/**
 * Which Chrome the real-browser tests drive.
 *
 *   CAPTURE_TEST_CHROME     path to a Chrome executable; CI sets it to a pinned Chrome for Testing
 *                           build so a Linux difference shows up now, not in M4 or M5 (docs/plan.md, M2)
 *   CAPTURE_REQUIRE_CHROME  "1" makes a missing Chrome a failure instead of a skip, so CI cannot pass
 *                           with the real-browser tests silently unrun
 * Without either, the first Chrome the helper would find is used, and the tests skip if there is none.
 */

import fs from 'node:fs';
import { findBrowsers } from '../../helper/src/chrome.js';

/** @returns {import('../../helper/src/chrome.js').FoundBrowser | undefined} */
function pick() {
    const pinned = process.env.CAPTURE_TEST_CHROME;
    if (pinned) {
        if (!fs.existsSync(pinned)) throw new Error(`CAPTURE_TEST_CHROME does not exist: ${pinned}`);
        return { channel: 'dev', path: pinned };
    }
    const found = findBrowsers()[0];
    if (!found && process.env.CAPTURE_REQUIRE_CHROME === '1') throw new Error('CAPTURE_REQUIRE_CHROME is set but no Chrome was found');
    return found;
}

/**
 * The Chrome to test with. Undefined when there is none: every user wraps its tests in
 * `describe.skipIf(!testChrome)`, so inside them it is always defined, which the type states.
 */
export const testChrome = /** @type {import('../../helper/src/chrome.js').FoundBrowser} */ (pick());
