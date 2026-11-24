/**
 * Command-line parsing for the helper, kept apart from bin/ so tests can import it.
 */

export const DEFAULT_ORIGIN = 'https://capture.waterfall-tools.com';

/**
 * @param {string[]} argv
 * @returns {{ origin: string, port: number }}
 */
export function parseArgs(argv) {
    let origin = DEFAULT_ORIGIN;
    let port = 0;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--origin') origin = argv[++i] ?? '';
        else if (arg === '--port') port = Number(argv[++i]);
        else throw new Error(`unknown argument: ${arg}`);
    }
    const parsed = new URL(origin);
    // Only an origin, and only https, except a loopback page for development.
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost');
    if (parsed.origin !== origin.replace(/\/$/, '') || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))) {
        throw new Error(`--origin must be an https origin (or http on loopback), got ${origin}`);
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0-65535');
    return { origin: parsed.origin, port };
}
