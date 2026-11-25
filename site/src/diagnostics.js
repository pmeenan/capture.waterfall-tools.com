/**
 * The minimal diagnostics log (M2, D-012): the steps of preflight and of each run, kept in memory,
 * saved only when the user downloads it. With no telemetry (D-010) it is the only way a failed run
 * can be reported. Nothing secret goes in: the helper's pairing secret is never logged.
 */

/**
 * @typedef {object} LogEntry
 * @property {string} at ISO time
 * @property {number} ms since the page loaded
 * @property {'info' | 'step' | 'error'} kind
 * @property {string} text
 */

export class DiagnosticsLog {
    /** @type {LogEntry[]} */
    #entries = [];
    #limit;
    #now;

    /**
     * @param {object} [options]
     * @param {number} [options.limit] oldest entries are dropped beyond this
     * @param {() => number} [options.now]
     */
    constructor({ limit = 5000, now = () => performance.now() } = {}) {
        this.#limit = limit;
        this.#now = now;
    }

    /**
     * @param {LogEntry['kind']} kind
     * @param {string} text
     */
    add(kind, text) {
        this.#entries.push({ at: new Date().toISOString(), ms: Math.round(this.#now()), kind, text });
        if (this.#entries.length > this.#limit) this.#entries.splice(0, this.#entries.length - this.#limit);
    }

    /** @param {string} text */
    info(text) { this.add('info', text); }
    /** @param {string} text */
    step(text) { this.add('step', text); }
    /** @param {string} text @param {unknown} [error] */
    error(text, error) {
        this.add('error', error === undefined ? text : `${text}: ${error instanceof Error ? error.message : String(error)}`);
    }

    get entries() {
        return [...this.#entries];
    }

    /**
     * The log as plain text, one entry per line, with a header saying what produced it.
     * @param {{version: string, userAgent?: string}} about
     */
    toText({ version, userAgent = globalThis.navigator?.userAgent ?? '' }) {
        const lines = [
            `Waterfall Tools Capture ${version} diagnostics log`,
            `Saved ${new Date().toISOString()}`,
            `Browser: ${userAgent}`,
            '',
            ...this.#entries.map((e) => `${e.at}  +${String(e.ms).padStart(7)} ms  ${e.kind.padEnd(5)}  ${e.text}`),
        ];
        return `${lines.join('\n')}\n`;
    }
}
