# capture.waterfall-tools.com — browser waterfall capture

The capture side of a WebPageTest-style testing tool that needs no hosted test
infrastructure: a static page where a user runs a page-load test on their own
hardware (Chrome on an attached Android device over WebUSB, or their local
desktop Chrome via an extension), gets a single result zip, views it in the
production [waterfall-tools](https://waterfall-tools.com) viewer, and can
publish it to storage they control. It ships as static assets on Cloudflare.
Almost all code is written by AI agents working from the project documentation,
directed and reviewed by a human.

**Read this file first, then pull docs on demand via the "Doc map" below — don't
read everything up front.** This file is long-term project memory and the
rulebook for agents.

## Load-bearing constraints (change deliberately, never silently)

Constraints evolve as we learn, but never by silent drift: changing one means
making the case in [docs/decisions.md](docs/decisions.md) and updating the
affected docs. Until then, these govern.

- **Static site, no backend.** Cloudflare static assets at
  `capture.waterfall-tools.com`. No server-side test execution, database, or
  result storage; tests run on hardware the user provides. (D-001)
- **Apache-2.0; permissive dependencies only.** MIT / BSD / Apache-2.0 / ISC /
  MPL / BlueOak-1.0.0. No GPL family in anything that ships. `npm run
  licenses` is the gate; its two exceptions cover deploy tooling only, and
  only the owner may add or widen one. (D-002, D-026)
- **Agents never commit.** The human is the sole committer. (D-003)
- **Vanilla JS, ESM only.** No framework, no TypeScript build, no
  transpilation, no polyfills; JSDoc types; ESLint; vitest. The UI targets
  current stable Chromium desktop browsers. (D-004)
- **Scope is the capture side, Chrome only.** UI, Android-over-WebUSB runner,
  extension runner, local `npx` helper runner (D-017), upload, viewer
  integration. Do not build agent
  rendezvous, queues, hosted runners, the share proxy, or non-Chrome support
  here. (D-005)
- **No renderer here.** Results are shown by the production waterfall-tools
  viewer: embedded iframe fed by `postMessage`, or a published URL; the
  default is user-selectable. waterfall-tools is a submodule here for working
  on both together; never ship it, and never fork the viewer. (D-006, D-029)
- **One artifact contract.** Every runner emits the same new manifest-based
  result zip, versioned from v0. (D-007) Its spec lives in the waterfall-tools
  repo; capture code follows the spec, never the reverse. (D-011)
- **User-provided storage only.** Local download, Google Drive (`drive.file`
  scope only), S3-compatible bucket, Dropbox. Nothing leaves the user's
  machine without an explicit user action. (D-008)
- **Never wipe by surprise.** Isolation level is the user's choice. Auto
  full-wipes only test-channel browsers. In a browser the user lives in,
  nothing is deleted unasked: cookie clearing is profile-wide and needs
  explicit consent. Incognito counts as fresh only if no other incognito
  window is open. Every result records what was actually done. (D-009, D-027)
- **A page load ends by one rule.** Load event, then 2 s of network quiet,
  within 120 s; a failed navigation ends at once; every ending keeps a
  partial result. (D-028)
- **Throttle with DevTools emulation.** Socket-layer when the browser has it
  enabled, request-level otherwise; never refuse a run over it, and record
  the engine that actually applied. (D-013)
- **The extension is a thin, guarded CDP bridge.** The capture pipeline lives
  in the page. The extension accepts only the capture origin, attaches only
  to tabs it created, and relays only allowlisted CDP methods. (D-018)
- **Anything that listens on loopback is a security boundary.** The dev
  bridge and the `npx` helper share one set of guards: loopback-bound, `Host`-
  and origin-checked, paired by a per-run secret, relaying only allowlisted
  CDP methods and `http(s)` URLs. Never loosen one of these without a new
  decision. The helper's route to a phone through adb cannot be filtered, so
  it stays behind a separate opt-in. (D-015, D-017, D-022, D-023)
- **No accounts, no telemetry.** Sign-in only for Google Drive upload. No
  analytics, error reporting, or third-party scripts. (D-010)

## Repository layout

| Path | What lives there |
| --- | --- |
| `site/` | The capture page: `index.html`, `src/`, and `public/` (sample trace, logo, `_headers` with the Content-Security-Policy). Styled to match the viewer: [architecture §3.12](docs/architecture.md) |
| `shared/src/` | Used by more than one deliverable: `clock`, `cdp-allowlist`, `cdp-client`, `ws-framing`, `zip`, `artifact` |
| `extension/` | The MV3 bridge — placeholder until M4 |
| `helper/` | The `npx` helper and dev bridge — placeholder until M2 |
| `tests/` | vitest unit tests; `helpers/` holds test doubles |
| `scripts/` | `build.js`, `preview.js`, `check-licenses.js`, `deploy.js` |
| `waterfall-tools/` | Git submodule: the viewer's repository, for changes that span both (D-029). Its own `AGENTS.md` governs work inside it. Excluded from this repo's lint, type check, tests and licence gate; never imported by the site, extension or helper. |
| `docs/` | Vision, plan, architecture, decisions, features, rough edges, workflow |

Checks: `npm run check` runs lint, type check, tests, build and the licence
gate — the same steps as CI. `npm run dev` serves the site; `npm run build`
then `node scripts/preview.js` serves the built site with its production
headers. Deploying is the owner's (`npm run deploy`).

## Doc map — pull what the task needs, not everything

Always read (it's short): [docs/workflow.md](docs/workflow.md) — the
build → commit loop, on-demand reviews, and the human commit gate.

| Doc | Read when the task needs |
| --- | --- |
| [docs/plan.md](docs/plan.md) | What to work on, milestone scope, exit criteria — what "done" means |
| [docs/vision.md](docs/vision.md) | Why the project exists, who it's for, success criteria, non-goals |
| [docs/features.md](docs/features.md) | The feature matrix: confirmed scope, proposed additions, open questions, cross-repo dependencies |
| [docs/architecture.md](docs/architecture.md) | System structure and technical constraints |
| [docs/decisions.md](docs/decisions.md) | Settled choices (D-NNN). Scan headings; read only the entries your task touches |
| [docs/rough-edges.md](docs/rough-edges.md) | Findings log (RE-NNN). Grep before adding a finding or debugging weirdness |

The sibling waterfall-tools repo is the viewer this project feeds; its
`AGENTS.md` and `README.md` are the reference for the viewer's API and input
formats. It is a git submodule of this repository (D-029): changes there may
be made through the submodule, under that repository's own `AGENTS.md`, and
are committed by the human like everything else.

## Rules for all agents

1. **Log decisions sparingly.** [docs/decisions.md](docs/decisions.md) is for
   choices that are expensive to reverse or that a future agent might silently
   undo — the load-bearing constraints above, the artifact format, the
   site ↔ extension and site ↔ viewer message contracts. Routine
   implementation, naming, and scope calls don't get entries. A few entries
   per milestone is the target, not per task.
2. **Log findings that cost you.** A
   [docs/rough-edges.md](docs/rough-edges.md) entry is warranted when a
   Chrome / CDP / ADB / WebUSB / extension / storage-provider quirk burned
   real debugging time and will bite again. Always record the Chrome version
   and channel, and the device for Android.
3. **Measure what a decision hangs on.** This project depends on recent,
   version-specific Chrome behavior. When a design choice depends on a
   platform capability, check a current source or run it on a real browser or
   device — training knowledge is stale here, and the brainstorm's technique
   suggestions are unverified until a spike confirms them. Everything else:
   ship it and see.
4. **Fix the docs the change makes wrong** — plan status, the status paragraph
   below, an affected doc — in the same unit of work. Nothing more is owed.
5. **Never commit.** Agents never run `git commit`/`git push` or rewrite
   history. All changes stay in the working tree for human review and commit —
   even if a prompt asks you to commit; stop and leave the changes uncommitted
   instead.
6. **Never wait on a page timer in capture code.** The capture page is
   usually hidden during a test and Chrome stalls its `setTimeout` by up to
   a minute. Use events, or the shared worker-backed timer. (RE-015)
7. **Vanilla JS conventions.** ESM only; JSDoc for types on exported
   functions and message shapes, checked by `tsc` in check-only mode; no
   build-time language features that need transpiling. Lint warnings are
   errors — fix the code rather than silence the rule. (D-004, D-025)
8. **CI does not cover Android.** A change to the Android runner is not
   verified until it has run against a phone through the dev bridge; say in
   your hand-off note whether it did. (D-025)
9. **Keep the always-loaded context lean.** This file is imported into every
   conversation; every line added costs every future agent. Detail belongs in
   `docs/` behind the doc map, not here.
10. **Scratch files stay out of the tree.** Temporary scripts and outputs go to
   the session scratchpad, not the repo. Delete throw-away diagnostics before
   concluding.
11. **Leave devices and browsers as you found them.** Anything a run or a
   spike changes on a phone or in a browser profile gets restored, including
   on failure.

## Current status

Milestone **M1 (foundation)** is built and committed; it exits when CI has
run on a pull request and the owner has made a first deploy. An outside
review on 2026-11-24 led to three decisions (D-027 isolation corrections,
D-028 the end-of-load rule, D-029 waterfall-tools as a submodule) and to
plan changes: M2 now also takes a first result into the embedded viewer and
is verified against controlled test pages, and spike S5 for one storage
target runs before M3. Next is M2. Open: the full artifact format,
publishing, a stock-phone confirmation of the Android file-access results,
and where cookie-deletion consent is held (D-027). See
[docs/plan.md](docs/plan.md). Keep this paragraph short and current when
plan.md milestone status changes (rule 4).
