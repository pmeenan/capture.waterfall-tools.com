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
  MPL. No GPL in any form. Check a dependency's license against its own
  package metadata before adding it. (D-002)
- **Agents never commit.** The human is the sole committer. (D-003)
- **Vanilla JS, ESM only.** No framework, no TypeScript build, no
  transpilation, no polyfills; JSDoc types; ESLint; vitest. The UI targets
  current stable Chromium desktop browsers. (D-004)
- **Scope is the capture side, Chrome only.** UI, Android-over-WebUSB runner,
  extension runner, upload, viewer integration. Do not build agent
  rendezvous, queues, hosted runners, the share proxy, or non-Chrome support
  here. (D-005)
- **No renderer here.** Results are shown by the production waterfall-tools
  viewer: embedded iframe fed by `postMessage`, or a published URL; the
  default is user-selectable. Never bundle or fork the viewer. (D-006)
- **One artifact contract.** Every runner emits the same new manifest-based
  result zip, versioned from v0. (D-007) Its spec lives in the waterfall-tools
  repo; capture code follows the spec, never the reverse. (D-011)
- **User-provided storage only.** Local download, Google Drive (`drive.file`
  scope only), S3-compatible bucket, Dropbox. Nothing leaves the user's
  machine without an explicit user action. (D-008)
- **Never wipe by surprise.** Isolation level is the user's choice; the Auto
  default full-wipes only test-channel browsers and uses a CDP-level clear on
  stable Chrome. Every result records the isolation actually applied. (D-009)
- **No accounts, no telemetry.** Sign-in only for Google Drive upload. No
  analytics, error reporting, or third-party scripts. (D-010)

## Repository layout

| Path    | What lives there |
| ------- | ---------------- |
| `docs/` | Vision, plan, architecture, decisions, features, rough edges, workflow |

The application scaffolding lands in M1 — update this table when it does.

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
formats. Changes needed there are tracked in features.md, not made from here.

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
6. **Vanilla JS conventions.** ESM only; JSDoc for types on exported
   functions and message shapes; no build-time language features that need
   transpiling. Lint warnings are errors — fix the code rather than silence
   the rule.
7. **Keep the always-loaded context lean.** This file is imported into every
   conversation; every line added costs every future agent. Detail belongs in
   `docs/` behind the doc map, not here.
8. **Scratch files stay out of the tree.** Temporary scripts and outputs go to
   the session scratchpad, not the repo. Delete throw-away diagnostics before
   concluding.
9. **Leave devices and browsers as you found them.** Anything a run or a
   spike changes on a phone or in a browser profile gets restored, including
   on failure.

## Current status

Milestone **M0 (plan the plan)** — the full feature set, architecture, and
milestone ladder are being worked out through planning conversations and six
feasibility spikes (S1–S6). The first triage pass is done: product-level
features are confirmed; what remains `proposed` is waiting on a spike. The
first release is cut after publishing works (D-012). See
[docs/plan.md](docs/plan.md). No application code
exists yet; scaffolding is M1. Keep this paragraph short and current when
plan.md milestone status changes (rule 4).
