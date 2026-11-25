/**
 * The "Local helper" card: pairing from the link the helper prints, the connection's state in
 * words, and a connection test (launch a Chrome in the helper, read its version, close it).
 */

import { CdpClient } from '@capture/shared/cdp-client';
import { FAILURE, HelperConnection, forgetPairing, takePairing } from './helper-connection.js';

/** @type {Record<string, string>} */
const FAILURE_WORDS = {
    [FAILURE.permissionDenied]: 'Chrome is blocking this site from reaching apps on this device. Allow it in the site settings (the icon left of the address), then reload.',
    [FAILURE.unreachable]: 'The helper is not running, or it refused this page. Start it and open the link it prints.',
    [FAILURE.rejected]: 'The helper did not accept this link: it is from an earlier run. Open the link the helper printed this time.',
    [FAILURE.timeout]: 'The helper did not answer. Check that it is still running.',
    [FAILURE.protocol]: 'This helper is a different version from the page. Update it and try again.',
};

/**
 * @param {object} deps
 * @param {HTMLElement} deps.status where the connection state is written
 * @param {HTMLElement} deps.actions where buttons go
 * @param {() => import('@capture/shared/clock').Clock} deps.createClock
 * @param {import('./diagnostics.js').DiagnosticsLog} deps.log
 * @param {(connection: HelperConnection, clock: import('@capture/shared/clock').Clock) => void} [deps.onPaired]
 */
export function wireHelper({ status, actions, createClock, log, onPaired = () => {} }) {
    const say = (/** @type {string} */ text, /** @type {string} */ state) => {
        status.textContent = text;
        status.dataset.state = state;
        log.info(`helper: ${text}`);
    };
    const pairing = takePairing();
    if (!pairing) {
        say('Not connected. Start the helper on this computer and open the link it prints.', 'idle');
        return;
    }

    const clock = createClock();
    say('Connecting to the helper…', 'connecting');
    HelperConnection.connect(pairing, { clock }, (state) => {
        if (state === 'permission-prompt') say('Chrome is asking whether this site may reach apps on this device. Choose Allow to use the helper.', 'prompt');
        else if (state === 'connecting') say('Connecting to the helper…', 'connecting');
    }).then((connection) => {
        const channels = connection.browsers.map((b) => b.channel);
        say(`Connected to helper ${connection.version}. Chrome found: ${channels.join(', ') || 'none'}.`, 'paired');
        onPaired(connection, clock);
        connection.onState((state, code) => {
            if (state === 'closed' || state === 'failed') {
                if (code === FAILURE.rejected) forgetPairing();
                say(state === 'failed' ? (FAILURE_WORDS[code ?? ''] ?? 'The helper connection failed.') : 'The helper stopped. Start it again and open the link it prints.', 'closed');
                actions.replaceChildren();
            }
        });

        const test = document.createElement('button');
        test.type = 'button';
        test.textContent = 'Test the connection';
        const result = document.createElement('p');
        result.className = 'detail';
        test.addEventListener('click', async () => {
            test.disabled = true;
            result.textContent = 'Starting Chrome in the helper…';
            try {
                await connection.launch({ channel: channels[0], headless: true });
                const client = new CdpClient(connection.cdpTransport(), { clock });
                const version = await client.send('Browser.getVersion', {}, undefined, { timeoutMs: 15000 });
                await connection.closeBrowser();
                result.textContent = `Works: ${version.product} started, answered and closed.`;
                result.dataset.state = 'yes';
            } catch (error) {
                result.textContent = `Test failed: ${error instanceof Error ? error.message : String(error)}`;
                result.dataset.state = 'no';
                await connection.closeBrowser().catch(() => {});
            } finally {
                test.disabled = false;
            }
        });
        actions.replaceChildren(test, result);
    }).catch((error) => {
        const code = /** @type {any} */ (error)?.code;
        if (code === FAILURE.rejected) forgetPairing();
        say(FAILURE_WORDS[code] ?? `Could not connect to the helper: ${error instanceof Error ? error.message : String(error)}`, 'failed');
        clock.dispose();
    });
}
