import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- waterfall-tools ships no type declarations
import { WaterfallTools } from 'waterfall-tools';
import { FORMAT_NAME, FORMAT_VERSION, buildArtifact } from '@capture/shared/artifact';

// A real Chrome trace of https://example.com/, with machine-identifying data removed.
const sampleTrace = new Uint8Array(readFileSync(new URL('../site/public/sample/example-trace.json.gz', import.meta.url)));
const generator = { name: 'test', version: '0.0.0' };
const created = new Date('2026-11-23T12:00:00Z');
const environment = /** @type {const} */ ({ runner: 'sample', browser: 'Chrome/157.0.8103.79', traceScope: 'browser' });

describe('buildArtifact', () => {
    it('writes a manifest that says the layout is provisional', () => {
        const { manifest } = buildArtifact({ test: { url: 'https://example.com/' }, environment, runs: [{ trace: sampleTrace }], generator, created });
        expect(manifest).toMatchObject({
            format: FORMAT_NAME,
            formatVersion: FORMAT_VERSION,
            provisional: true,
            created: '2026-11-23T12:00:00.000Z',
            test: { url: 'https://example.com/' },
            environment: { runner: 'sample' },
            runs: [{ index: 1, view: 'first', files: { trace: 'runs/1/trace.json.gz' } }],
        });
        expect(FORMAT_VERSION).toMatch(/provisional/);
    });

    it('puts the manifest first and each payload where the manifest says', () => {
        const netlog = new TextEncoder().encode('{"constants":{},"events":[');
        const video = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
        const { zip, manifest } = buildArtifact({
            test: { url: 'https://example.com/' },
            environment,
            runs: [{ trace: sampleTrace, netlog, video, videoAnalysis: { startOffsetMs: 534 } }, { trace: sampleTrace }],
            generator,
            created,
        });
        const files = unzipSync(zip);
        expect(Object.keys(files)).toEqual(['manifest.json', 'runs/1/trace.json.gz', 'runs/1/netlog.json', 'runs/1/video.mp4', 'runs/2/trace.json.gz']);
        expect(JSON.parse(new TextDecoder().decode(files['manifest.json']))).toEqual(manifest);
        expect(files[manifest.runs[0].files.netlog]).toEqual(netlog);
        expect(files[manifest.runs[0].files.video]).toEqual(video);
        expect(manifest.runs[0].videoAnalysis).toEqual({ startOffsetMs: 534 });
        expect(manifest.runs[1]).toEqual({ index: 2, view: 'first', files: { trace: 'runs/2/trace.json.gz' } });
    });

    it('refuses an artifact with no runs, or a run with no payloads', () => {
        expect(() => buildArtifact({ test: { url: 'https://example.com/' }, environment, runs: [], generator })).toThrow(/at least one run/);
        expect(() => buildArtifact({ test: { url: 'https://example.com/' }, environment, runs: [{}], generator })).toThrow(/no payloads/);
    });

    // The M1 exit criterion: a trace taken out of an artifact still converts with the
    // published waterfall-tools, so the artifact carries payloads the viewer can use
    // even before it understands the artifact itself.
    it('carries a trace that the published waterfall-tools can read', async () => {
        const { zip, manifest } = buildArtifact({ test: { url: 'https://example.com/' }, environment, runs: [{ trace: sampleTrace }], generator, created });
        const trace = unzipSync(zip)[manifest.runs[0].files.trace];
        expect(trace).toEqual(sampleTrace);
        const tools = new WaterfallTools();
        try {
            await tools.loadBuffer(trace);
            const har = tools.getHar();
            const urls = har.log.entries.map((/** @type {{request: {url: string}}} */ entry) => entry.request.url);
            expect(urls).toContain('https://example.com/');
            expect(har.log.pages.length).toBeGreaterThan(0);
        } finally {
            await tools.destroy?.();
        }
    });
});
