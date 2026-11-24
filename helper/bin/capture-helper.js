#!/usr/bin/env node
/**
 * The local helper (D-017, D-022): run it, open the link it prints, and the capture page can run
 * tests in a dedicated Chrome on this computer.
 *
 *   capture-helper [--origin <capture origin>] [--port <n>]
 *
 * --origin exists for development against a local capture page; the default is the production
 * capture site. Whatever it is, it is the only origin the helper will accept.
 */

import fs from 'node:fs';
import { findBrowsers, launchBrowser } from '../src/chrome.js';
import { newSecret, startHelperServer } from '../src/server.js';
import { parseArgs } from '../src/cli.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(String(/** @type {Error} */ (error).message));
        process.exit(2);
    }
    const browsers = findBrowsers();
    if (browsers.length === 0) {
        console.error('No Chrome was found on this computer. Install Google Chrome and run this again.');
        process.exit(1);
    }
    const secret = newSecret();
    const helper = await startHelperServer({
        captureOrigin: options.origin,
        secret,
        browsers,
        launch: (o) => launchBrowser(o),
        version,
        port: options.port,
        log: (line) => console.log(`  ${new Date().toLocaleTimeString()}  ${line}`),
    });
    console.log(`Capture helper ${version}`);
    console.log(`Found Chrome: ${browsers.map((b) => b.channel).join(', ')}`);
    console.log('');
    console.log('Open this link in Chrome to connect the capture page to this helper:');
    console.log(`  ${options.origin}/#helper=${helper.port}:${secret}`);
    console.log('');
    console.log('Keep this window open while you run tests. Press Ctrl+C to stop.');

    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        await helper.close();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main();
