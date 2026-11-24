/**
 * The filter between the paired page and the helper's Chrome (D-022 rule 4, architecture §3.7).
 *
 * Two checks per command:
 *   1. the shared allowlist of methods and URLs (D-018, D-033), the same one the extension uses;
 *   2. ownership: `Target.attachToTarget` and `Target.closeTarget` only for targets this relay
 *      created with `Target.createTarget`. The allowlist checks names, so it cannot know whose
 *      target an id is; the relay can, because it sees every reply.
 * And on the way back, events and replies about targets the page does not own are dropped, so
 * the page learns nothing about the browser's other targets.
 *
 * No I/O here: `fromPage` and `fromBrowser` return what to send where, so tests drive it directly.
 */

import { vetCommand } from '@capture/shared/cdp-allowlist';

/** JSON-RPC's "server error" range; what Chrome itself uses for refused commands. */
const REFUSED = -32000;

/**
 * @typedef {object} RelayDecision
 * @property {string | null} toBrowser the message to forward to Chrome, or null
 * @property {string | null} toPage a reply for the page (a refusal), or null
 */

export class Relay {
    /** Targets this relay created. */
    /** @type {Set<string>} */
    #ownedTargets = new Set();
    /** Sessions this relay attached to an owned target, mapped to that target. */
    /** @type {Map<string, string>} */
    #ownedSessions = new Map();
    /** Commands forwarded and not answered yet, by id: what to learn from the reply. */
    /** @type {Map<number, {method: string, targetId?: string}>} */
    #pending = new Map();

    /**
     * A message from the page.
     * @param {string} text
     * @returns {RelayDecision}
     */
    fromPage(text) {
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return { toBrowser: null, toPage: null };
        }
        const id = message?.id;
        if (!Number.isSafeInteger(id) || typeof message.method !== 'string') return { toBrowser: null, toPage: null };
        const refuse = (/** @type {string} */ reason) => ({
            toBrowser: null,
            toPage: JSON.stringify({ id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), error: { code: REFUSED, message: reason } }),
        });
        if (this.#pending.has(id)) return refuse('duplicate command id');

        const { method, params, sessionId } = message;
        if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) return refuse('params must be an object');
        const vetted = vetCommand(method, params);
        if (vetted) return refuse(vetted);
        if (sessionId !== undefined && !this.#ownedSessions.has(sessionId)) return refuse('unknown session');
        if (method === 'Target.attachToTarget' || method === 'Target.closeTarget') {
            if (!this.#ownedTargets.has(params?.targetId)) return refuse(`${method} is only allowed for targets this page created`);
        }
        if (method === 'Target.attachToTarget' && params?.flatten !== true) return refuse('Target.attachToTarget needs flatten: true');

        this.#pending.set(id, { method, targetId: params?.targetId });
        // Re-serialize only the fields CDP reads, so nothing unexpected rides along.
        const forwarded = { id, method, ...(params !== undefined ? { params } : {}), ...(sessionId !== undefined ? { sessionId } : {}) };
        return { toBrowser: JSON.stringify(forwarded), toPage: null };
    }

    /**
     * A message from Chrome.
     * @param {string} text
     * @returns {string | null} what to send the page, or null to drop it
     */
    fromBrowser(text) {
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            return null;
        }
        if (Number.isSafeInteger(message?.id)) {
            const command = this.#pending.get(message.id);
            if (!command) return null; // not ours: the page never sent this id
            this.#pending.delete(message.id);
            if (!message.error) this.#learn(command, message.result);
            return text;
        }
        // An event. Session-scoped events belong to an owned session by construction; browser-level
        // target events are passed only for owned targets.
        if (message?.sessionId !== undefined) return this.#ownedSessions.has(message.sessionId) ? text : null;
        if (typeof message?.method === 'string' && message.method.startsWith('Target.')) {
            const targetId = message.params?.targetInfo?.targetId ?? message.params?.targetId;
            if (message.method === 'Target.detachedFromTarget' && message.params?.sessionId) {
                const owned = this.#ownedSessions.has(message.params.sessionId);
                this.#ownedSessions.delete(message.params.sessionId);
                return owned ? text : null;
            }
            if (message.method === 'Target.targetDestroyed' && this.#ownedTargets.has(targetId)) {
                this.#ownedTargets.delete(targetId);
                for (const [session, target] of this.#ownedSessions) if (target === targetId) this.#ownedSessions.delete(session);
                return text;
            }
            return this.#ownedTargets.has(targetId) ? text : null;
        }
        return text;
    }

    /**
     * Record what a successful reply grants.
     * @param {{method: string, targetId?: string}} command
     * @param {any} result
     */
    #learn(command, result) {
        if (command.method === 'Target.createTarget' && typeof result?.targetId === 'string') {
            this.#ownedTargets.add(result.targetId);
        } else if (command.method === 'Target.attachToTarget' && typeof result?.sessionId === 'string' && command.targetId) {
            this.#ownedSessions.set(result.sessionId, command.targetId);
        } else if (command.method === 'Target.closeTarget' && command.targetId) {
            this.#ownedTargets.delete(command.targetId);
            for (const [session, target] of this.#ownedSessions) if (target === command.targetId) this.#ownedSessions.delete(session);
        }
    }
}
