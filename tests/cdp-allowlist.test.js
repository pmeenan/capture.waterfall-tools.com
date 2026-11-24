import { describe, expect, it } from 'vitest';
import { ALLOWED_METHODS, isUrlAllowed, vetCommand } from '@capture/shared/cdp-allowlist';

describe('CDP allowlist', () => {
    it('allows what the pipeline needs', () => {
        expect(vetCommand('Tracing.start', {})).toBeNull();
        expect(vetCommand('Page.navigate', { url: 'https://example.com/' })).toBeNull();
        expect(vetCommand('Target.createTarget', { url: 'about:blank' })).toBeNull();
    });

    // Every one of these was tried against an unfiltered relay in spike S8 (RE-014).
    it.each([
        'DOM.setFileInputFiles',
        'Browser.setDownloadBehavior',
        'Page.setDownloadBehavior',
        'Network.loadNetworkResource',
        'SystemInfo.getProcessInfo',
        'Target.attachToBrowserTarget',
        'Target.getTargets',
        'Page.printToPDF',
        'Storage.getCookies',
        'IO.resolveBlob',
        // Clears every cookie in the profile, not just the tested site's: refused (see the allowlist).
        'Network.clearBrowserCookies',
    ])('refuses %s', (method) => {
        expect(vetCommand(method, {})).toMatch(/not on the allowlist/);
    });

    it.each([
        'file:///C:/Users/someone/secret.txt',
        'file://localhost/etc/passwd',
        'chrome://settings',
        'chrome-extension://abcdefghijklmnop/page.html',
        'data:text/html,<script>1</script>',
        'javascript:alert(1)',
        'view-source:https://example.com/',
        'blob:https://example.com/1234',
        'ftp://example.com/',
        'about:config',
        '',
        'not a url',
    ])('refuses to load %s', (url) => {
        expect(isUrlAllowed(url)).toBe(false);
        expect(vetCommand('Page.navigate', { url })).toMatch(/may only load/);
        expect(vetCommand('Target.createTarget', { url })).toMatch(/may only load/);
    });

    it('refuses a navigation with no usable url', () => {
        expect(vetCommand('Page.navigate', {})).toMatch(/may only load/);
        expect(vetCommand('Page.navigate', undefined)).toMatch(/may only load/);
        expect(vetCommand('Page.navigate', { url: 42 })).toMatch(/may only load/);
        expect(vetCommand('Page.navigate', { url: { toString: () => 'https://example.com/' } })).toMatch(/may only load/);
    });

    it('allows http, https and the blank page only', () => {
        expect(isUrlAllowed('http://example.com/')).toBe(true);
        expect(isUrlAllowed('https://example.com/a?b=c#d')).toBe(true);
        expect(isUrlAllowed('HTTPS://EXAMPLE.COM/')).toBe(true);
        expect(isUrlAllowed('about:blank')).toBe(true);
    });

    it('stays small enough to review', () => {
        // Not a hard limit: a reminder that every addition is a security change (see the module comment).
        expect(ALLOWED_METHODS.size).toBeLessThan(40);
        for (const method of ALLOWED_METHODS) expect(method).toMatch(/^[A-Z][A-Za-z]+\.[a-z][A-Za-z]+$/);
    });
});
