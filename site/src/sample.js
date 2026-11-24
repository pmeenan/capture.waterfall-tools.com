/**
 * Builds a result artifact from a trace recorded ahead of time. It exists to
 * exercise the artifact builder and the download path before any runner does,
 * and it never pretends to be a test that was run here.
 */

import { buildArtifact } from '@capture/shared/artifact';
import { SITE_VERSION } from './version.js';

const SAMPLE_TRACE_URL = '/sample/example-trace.json.gz';

/**
 * @returns {Promise<{blob: Blob, filename: string, manifest: Record<string, any>, traceEvents: number}>}
 */
export async function buildSampleResult() {
    const response = await fetch(SAMPLE_TRACE_URL);
    if (!response.ok) throw new Error(`could not load the sample trace (HTTP ${response.status})`);
    const trace = new Uint8Array(await response.arrayBuffer());
    const { zip, manifest } = buildArtifact({
        test: { url: 'https://example.com/', label: 'Sample: recorded trace, not run in this browser' },
        environment: { runner: 'sample', browser: 'Chrome/157.0.8103.79', traceScope: 'browser', throttlingEngine: 'none' },
        runs: [{ trace }],
        generator: { name: 'capture.waterfall-tools.com', version: SITE_VERSION },
    });
    return {
        blob: new Blob([/** @type {BlobPart} */ (zip)], { type: 'application/zip' }),
        filename: 'capture-sample.zip',
        manifest,
        traceEvents: await countTraceEvents(trace),
    };
}

/**
 * Read the trace back the way a consumer would, to show it is intact.
 * @param {Uint8Array} gzipped
 * @returns {Promise<number>}
 */
async function countTraceEvents(gzipped) {
    const stream = new Blob([/** @type {BlobPart} */ (gzipped)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const trace = JSON.parse(await new Response(stream).text());
    return Array.isArray(trace.traceEvents) ? trace.traceEvents.length : 0;
}
