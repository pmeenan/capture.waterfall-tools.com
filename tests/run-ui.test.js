// The pieces of the run UI that carry a rule: which viewer origin results are posted to (never one
// from a URL parameter in production, architecture §3.11), what counts as a testable address, and
// what the diagnostics log keeps.
import { describe, expect, it } from 'vitest';
import { PRODUCTION_VIEWER, viewerOrigin } from '../site/src/viewer-embed.js';
import { normalizeUrl } from '../site/src/run-ui.js';
import { DiagnosticsLog } from '../site/src/diagnostics.js';

/** @param {string} href */
const at = (href) => /** @type {Location} */ (/** @type {unknown} */ (new URL(href)));

describe('viewer origin', () => {
    it('is always the production viewer on the production site, whatever the URL says', () => {
        expect(viewerOrigin(at('https://capture.waterfall-tools.com/'))).toBe(PRODUCTION_VIEWER);
        expect(viewerOrigin(at('https://capture.waterfall-tools.com/?viewer=http://127.0.0.1:5180'))).toBe(PRODUCTION_VIEWER);
        expect(viewerOrigin(at('https://capture.waterfall-tools.com/?viewer=https://evil.example'))).toBe(PRODUCTION_VIEWER);
    });

    it('may be a loopback viewer only when the page itself is on loopback', () => {
        expect(viewerOrigin(at('http://localhost:4173/?viewer=http://127.0.0.1:5180/'))).toBe('http://127.0.0.1:5180');
        expect(viewerOrigin(at('http://127.0.0.1:5173/?viewer=http://localhost:5180'))).toBe('http://localhost:5180');
        expect(viewerOrigin(at('http://localhost:4173/?viewer=https://evil.example'))).toBe(PRODUCTION_VIEWER);
        expect(viewerOrigin(at('http://localhost:4173/?viewer=javascript:alert(1)'))).toBe(PRODUCTION_VIEWER);
        expect(viewerOrigin(at('http://localhost:4173/?viewer=nonsense'))).toBe(PRODUCTION_VIEWER);
        expect(viewerOrigin(at('http://localhost:4173/'))).toBe(PRODUCTION_VIEWER);
    });
});

describe('test address', () => {
    it.each([
        ['example.com', 'https://example.com/'],
        ['  https://example.com/a?b=c  ', 'https://example.com/a?b=c'],
        ['http://localhost:8080', 'http://localhost:8080/'],
        ['', null],
        ['file:///etc/passwd', null],
        ['chrome://flags', null],
        ['javascript:alert(1)', null],
        ['http://', null],
    ])('%j becomes %j', (input, expected) => {
        expect(normalizeUrl(input)).toBe(expected);
    });
});

describe('diagnostics log', () => {
    it('keeps entries in order, as text with a header', () => {
        let t = 0;
        const log = new DiagnosticsLog({ now: () => (t += 10) });
        log.info('page loaded');
        log.step('navigate');
        log.error('run failed', new Error('boom'));
        expect(log.entries.map((e) => [e.kind, e.text])).toEqual([['info', 'page loaded'], ['step', 'navigate'], ['error', 'run failed: boom']]);
        const text = log.toText({ version: '1.2.3', userAgent: 'TestBrowser/1' });
        expect(text).toMatch(/^Waterfall Tools Capture 1\.2\.3 diagnostics log\n/);
        expect(text).toContain('Browser: TestBrowser/1');
        expect(text).toMatch(/error\s+run failed: boom/);
    });

    it('drops the oldest entries beyond its limit', () => {
        const log = new DiagnosticsLog({ limit: 3 });
        for (let i = 0; i < 5; i++) log.info(`entry ${i}`);
        expect(log.entries.map((e) => e.text)).toEqual(['entry 2', 'entry 3', 'entry 4']);
    });
});
