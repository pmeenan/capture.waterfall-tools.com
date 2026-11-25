/**
 * A test run in a browser the helper launches: launch with a NetLog, run the page load, close the
 * browser (which completes the NetLog), and package everything into a result zip (D-007, D-028).
 *
 * The browser host is anything with launch / cdpTransport / closeBrowser: in the page that is the
 * HelperConnection; tests drive Chrome on the pipe directly, through the same three calls.
 */

import { buildArtifact } from '@capture/shared/artifact';
import { CdpClient } from '@capture/shared/cdp-client';
import { runPageLoad } from './page-load.js';

/**
 * @typedef {object} BrowserHost
 * @property {(options: {channel: string, features?: string[], headless?: boolean, netLog?: boolean}) => Promise<void>} launch
 * @property {() => import('@capture/shared/cdp-client').CdpTransport} cdpTransport
 * @property {() => Promise<{netLog: string | null}>} closeBrowser
 */

/**
 * @typedef {object} HelperRunResult
 * @property {Uint8Array} zip the result artifact
 * @property {Record<string, any>} manifest
 * @property {import('./page-load.js').PageLoadResult} load
 * @property {string} browser product and version, e.g. Chrome/158.0.8127.88
 */

/**
 * @param {object} options
 * @param {BrowserHost} options.host
 * @param {import('@capture/shared/clock').Clock} options.clock
 * @param {string} options.url
 * @param {string} options.channel
 * @param {string[]} [options.features]
 * @param {boolean} [options.headless]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeLimitMs]
 * @param {{name: string, version: string}} options.generator
 * @param {(step: string) => void} [options.onStep]
 * @returns {Promise<HelperRunResult>}
 */
export async function runWithHelper({ host, clock, url, channel, features = [], headless = false, signal, timeLimitMs, generator, onStep = () => {} }) {
    onStep('launch Chrome');
    await host.launch({ channel, features, headless, netLog: true });
    const client = new CdpClient(host.cdpTransport(), { clock });
    /** @type {import('./page-load.js').PageLoadResult | undefined} */
    let load;
    /** @type {string} */
    let browser;
    /** @type {string | null} */
    let netLog;
    try {
        browser = (await client.send('Browser.getVersion')).product;
        load = await runPageLoad({ client, clock, url, signal, timeLimitMs, onStep });
    } finally {
        // Closing is what completes the NetLog, and it runs on every path: success, failure, cancel.
        onStep('close Chrome');
        netLog = (await host.closeBrowser().catch(() => ({ netLog: null }))).netLog;
        client.close();
    }

    if (!load) throw new Error('the page load produced no result'); // unreachable: a failure throws above

    onStep('package the result');
    const { zip, manifest } = buildArtifact({
        test: { url },
        environment: {
            runner: 'helper',
            browser,
            traceScope: 'browser',
            // No throttling yet; the engine that applies is detected once throttling lands (D-013).
            throttlingEngine: 'none',
            isolation: 'fresh profile',
        },
        runs: [{
            trace: load.trace,
            ...(netLog !== null ? { netlog: await gzip(netLog) } : {}),
            ending: load.ending,
            timings: load.timings,
            document: load.document,
        }],
        generator,
    });
    return { zip, manifest, load, browser };
}

/**
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
