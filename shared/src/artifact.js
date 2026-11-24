/**
 * Builds the result artifact: one zip holding a manifest and the captured
 * payloads of each run (D-007).
 *
 * THE LAYOUT HERE IS PROVISIONAL. The real format is specified in the
 * waterfall-tools repository (D-011) and that specification does not exist
 * yet. Until it does, every artifact says so in its manifest, so that nothing
 * written now can be mistaken for the published format later. When the spec
 * lands this module changes to follow it; the spec does not change to follow
 * this module.
 */

import { createZip } from './zip.js';

export const FORMAT_NAME = 'waterfall-capture';
export const FORMAT_VERSION = '0-provisional';

const encoder = new TextEncoder();

/**
 * How one run was captured. Each field records what actually happened, not
 * what was requested (D-009, D-013, D-014). Fields a runner cannot determine
 * are left out rather than guessed.
 * @typedef {object} Environment
 * @property {'android' | 'extension' | 'helper' | 'sample'} runner
 * @property {string} [browser] product and version, for example `Chrome/160.0.8180.0`
 * @property {string} [device] for Android, the model
 * @property {'socket-layer' | 'request-level' | 'none' | 'unknown'} [throttlingEngine] `unknown` when it could not be determined - never a guess (D-013)
 * @property {string} [isolation] the isolation level applied
 * @property {'browser' | 'page'} [traceScope]
 * @property {string} [videoSource]
 */

/**
 * Payloads of one page load. Anything not captured is simply absent.
 * @typedef {object} RunPayloads
 * @property {Uint8Array} [trace] gzipped Chrome trace JSON
 * @property {Uint8Array} [netlog] NetLog JSON as pulled
 * @property {Uint8Array} [video] MP4 as recorded
 * @property {Record<string, unknown>} [videoAnalysis] start offset, crop rectangle, kept-frame times (D-021)
 */

/**
 * @typedef {object} ArtifactInput
 * @property {{url: string, label?: string}} test
 * @property {Environment} environment
 * @property {RunPayloads[]} runs
 * @property {{name: string, version: string}} generator
 * @property {Date} [created]
 */

/**
 * @param {ArtifactInput} input
 * @returns {{zip: Uint8Array, manifest: Record<string, any>}}
 */
export function buildArtifact({ test, environment, runs, generator, created = new Date() }) {
    if (!runs.length) throw new Error('an artifact needs at least one run');
    /** @type {import('./zip.js').ZipEntry[]} */
    const entries = [];
    const manifestRuns = runs.map((run, i) => {
        const dir = `runs/${i + 1}`;
        /** @type {Record<string, string>} */
        const files = {};
        /** @type {[keyof RunPayloads, string][]} */
        const known = [
            ['trace', 'trace.json.gz'],
            ['netlog', 'netlog.json'],
            ['video', 'video.mp4'],
        ];
        for (const [key, filename] of known) {
            const data = run[key];
            if (data instanceof Uint8Array) {
                files[key] = `${dir}/${filename}`;
                entries.push({ name: files[key], data });
            }
        }
        if (!Object.keys(files).length) throw new Error(`run ${i + 1} has no payloads`);
        return {
            index: i + 1,
            // The first release captures first views only; the field is here so that
            // repeat views fit later without changing the shape (D-007, D-012).
            view: 'first',
            files,
            ...(run.videoAnalysis ? { videoAnalysis: run.videoAnalysis } : {}),
        };
    });
    const manifest = {
        format: FORMAT_NAME,
        formatVersion: FORMAT_VERSION,
        provisional: true,
        note: 'Provisional layout written before the artifact specification existed. Do not rely on it.',
        created: created.toISOString(),
        generator,
        test,
        environment,
        runs: manifestRuns,
    };
    // The manifest goes first so a reader that streams the archive meets it before the payloads.
    entries.unshift({ name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2) + '\n') });
    return { zip: createZip(entries, created), manifest };
}
