// The helper's relay filter (D-022 rule 4, architecture §3.7): the shared allowlist plus "own
// targets only", which the allowlist cannot know about. RE-014's abuse attempts are repeated here
// at the relay, where they are actually stopped.
import { describe, expect, it } from 'vitest';
import { Relay } from '../helper/src/relay.js';

/** @param {number} id @param {string} method @param {object} [params] @param {string} [sessionId] */
const cmd = (id, method, params, sessionId) => JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) });

/** A relay that has created target T1 and attached session S1 to it. */
function relayWithTarget() {
    const relay = new Relay();
    relay.fromPage(cmd(1, 'Target.createTarget', { url: 'about:blank' }));
    relay.fromBrowser(JSON.stringify({ id: 1, result: { targetId: 'T1' } }));
    relay.fromPage(cmd(2, 'Target.attachToTarget', { targetId: 'T1', flatten: true }));
    relay.fromBrowser(JSON.stringify({ id: 2, result: { sessionId: 'S1' } }));
    return relay;
}
const refusal = (/** @type {import('../helper/src/relay.js').RelayDecision} */ decision) => decision.toPage && JSON.parse(decision.toPage).error?.message;

describe('relay: what reaches Chrome', () => {
    it('forwards allowed commands as a clean re-serialization', () => {
        const relay = relayWithTarget();
        const d = relay.fromPage(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 'S1', extra: 'dropped' }));
        expect(d.toPage).toBeNull();
        expect(JSON.parse(/** @type {string} */ (d.toBrowser))).toEqual({ id: 3, method: 'Page.navigate', params: { url: 'https://example.com/' }, sessionId: 'S1' });
    });

    // RE-014: each of these succeeded against an unfiltered relay.
    it.each([
        ['file navigation', cmd(3, 'Page.navigate', { url: 'file:///C:/Users/someone/secret.txt' }, 'S1')],
        ['file target', cmd(3, 'Target.createTarget', { url: 'file:///etc/passwd' })],
        ['file inputs', cmd(3, 'DOM.setFileInputFiles', { files: ['/etc/passwd'] }, 'S1')],
        ['downloads', cmd(3, 'Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp' })],
        ['network loads', cmd(3, 'Network.loadNetworkResource', { url: 'file:///etc/passwd' }, 'S1')],
        ['system info', cmd(3, 'SystemInfo.getProcessInfo')],
        ['every cookie', cmd(3, 'Network.clearBrowserCookies', undefined, 'S1')],
        ['browser-wide attach', cmd(3, 'Target.attachToBrowserTarget')],
    ])('refuses %s', (_label, text) => {
        const d = relayWithTarget().fromPage(text);
        expect(d.toBrowser).toBeNull();
        expect(refusal(d)).toBeTruthy();
    });

    it('refuses attaching to or closing a target it did not create', () => {
        const relay = relayWithTarget();
        for (const method of ['Target.attachToTarget', 'Target.closeTarget']) {
            const d = relay.fromPage(cmd(3, method, { targetId: 'someone-elses', flatten: true }));
            expect(d.toBrowser).toBeNull();
            expect(refusal(d)).toMatch(/only allowed for targets this page created/);
        }
        expect(relay.fromPage(cmd(4, 'Target.closeTarget', { targetId: 'T1' })).toBrowser).not.toBeNull();
    });

    it('refuses a non-flat attach and a session it did not attach', () => {
        const relay = relayWithTarget();
        expect(refusal(relay.fromPage(cmd(3, 'Target.attachToTarget', { targetId: 'T1' })))).toMatch(/flatten/);
        expect(refusal(relay.fromPage(cmd(4, 'Runtime.evaluate', { expression: '1' }, 'S-other')))).toMatch(/unknown session/);
    });

    it('forgets a target once it is closed', () => {
        const relay = relayWithTarget();
        relay.fromPage(cmd(3, 'Target.closeTarget', { targetId: 'T1' }));
        relay.fromBrowser(JSON.stringify({ id: 3, result: { success: true } }));
        expect(refusal(relay.fromPage(cmd(4, 'Target.attachToTarget', { targetId: 'T1', flatten: true })))).toMatch(/only allowed/);
        expect(refusal(relay.fromPage(cmd(5, 'Runtime.evaluate', { expression: '1' }, 'S1')))).toMatch(/unknown session/);
    });

    it('does not learn ownership from a failed reply', () => {
        const relay = new Relay();
        relay.fromPage(cmd(1, 'Target.createTarget', { url: 'about:blank' }));
        relay.fromBrowser(JSON.stringify({ id: 1, error: { code: -32000, message: 'nope' }, result: { targetId: 'T9' } }));
        expect(refusal(relay.fromPage(cmd(2, 'Target.attachToTarget', { targetId: 'T9', flatten: true })))).toMatch(/only allowed/);
    });

    it('ignores garbage and refuses bad shapes without forwarding', () => {
        const relay = relayWithTarget();
        expect(relay.fromPage('not json')).toEqual({ toBrowser: null, toPage: null });
        expect(relay.fromPage(JSON.stringify({ method: 'Browser.getVersion' }))).toEqual({ toBrowser: null, toPage: null });
        expect(refusal(relay.fromPage(JSON.stringify({ id: 9, method: 'Browser.getVersion', params: [1] })))).toMatch(/params/);
        relay.fromPage(cmd(10, 'Browser.getVersion'));
        expect(refusal(relay.fromPage(cmd(10, 'Browser.getVersion')))).toMatch(/duplicate/);
    });
});

describe('relay: what reaches the page', () => {
    it('passes replies only for commands the page sent', () => {
        const relay = relayWithTarget();
        relay.fromPage(cmd(3, 'Browser.getVersion'));
        expect(relay.fromBrowser(JSON.stringify({ id: 3, result: { product: 'Chrome/158' } }))).not.toBeNull();
        expect(relay.fromBrowser(JSON.stringify({ id: 3, result: {} }))).toBeNull(); // answered already
        expect(relay.fromBrowser(JSON.stringify({ id: 99, result: {} }))).toBeNull();
    });

    it('passes events of owned sessions and targets, and drops the rest', () => {
        const relay = relayWithTarget();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S1' }))).not.toBeNull();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Page.loadEventFired', params: {}, sessionId: 'S-other' }))).toBeNull();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Target.targetInfoChanged', params: { targetInfo: { targetId: 'T1', url: 'x' } } }))).not.toBeNull();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'T-other', url: 'chrome://newtab' } } }))).toBeNull();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Tracing.dataCollected', params: { value: [] } }))).not.toBeNull();
    });

    it('forgets a session when Chrome detaches it', () => {
        const relay = relayWithTarget();
        expect(relay.fromBrowser(JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: 'S1', targetId: 'T1' } }))).not.toBeNull();
        expect(refusal(relay.fromPage(cmd(3, 'Runtime.evaluate', { expression: '1' }, 'S1')))).toMatch(/unknown session/);
    });
});
