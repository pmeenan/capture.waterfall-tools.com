# Decision log

Newest first. Every entry: what was decided, why, and what would reopen it.
Entries are for choices that are expensive to reverse or that a future agent
might silently undo — not routine implementation calls; a few per milestone is
the target. Existing entries are never edited into a different decision —
reversing or amending one gets a *new* entry that supersedes it (a status-line
annotation on the old entry is fine). When an entry hangs on a claim about
current technology state, check a current source or run a local experiment —
training knowledge is stale.

**Reading:** scan the D-NNN headings (or grep) and read only the entries your
task touches. Full read is for structural or cross-cutting work.

**Culling:** the log may be periodically pruned — superseded or moot entries
whose context no longer informs anything current are deleted outright; git
history is the archive. D-numbers are never reused.

Format:

```
## D-NNN: Title  (YYYY-MM-DD, status: accepted | proposed | superseded by D-MMM)
Decision / Context / Consequences / Reopen if
```

**About the kickoff entries.** D-001..D-008 were seeded on 2026-11-23 from the
project owner's request, their answers to the kickoff questions, and their own
statements in the brainstorming transcript the project started from. That
transcript also contains many technique suggestions made by an AI assistant
(specific CDP methods, adb commands, Chrome version numbers, Cloudflare
configuration). Those are **not** decisions and are **not verified**; they
live in [features.md](features.md) as `proposed` rows or open questions until
an M0 spike or a current source confirms them. D-009..D-012 came out of the
M0 feature triage the same day.

---

## D-012: The first release is cut after publishing works  (2026-11-23, status: accepted)

**Decision.** The first public release is the point where both runners can
capture a page load with throttling, video, and NetLog, show it in the
embedded viewer, and publish it — the end of M5 in the current ladder. The
test model (multi-run, first/repeat view, CPU calibration, device emulation,
real-radio mode), the breadth items (local history, open-existing-zip,
diagnostics log, APK install, managed-profile detection), and scripting stay
confirmed scope but ship afterwards.

**Context.** Decided by the project owner at the end of the first triage
pass, which had promoted every product-level feature and produced a nine-step
ladder. Nothing in the first release depends on the deferred items, and
scripting is the largest single one.

**Consequences.** Milestone numbers will change when M0 rewrites the ladder;
the cut is defined by the capability above, not by "M5". The artifact format
must still reserve structure for multiple runs and repeat view from v0
(D-007). With no telemetry (D-010) and the diagnostics log after the cut,
first-release failures will be hard to diagnose remotely — accepted for now.

**Reopen if.** A deferred item turns out to be needed for the first release
to be credible (the diagnostics log and multi-run are the likeliest).

## D-011: The artifact spec lives in the waterfall-tools repo  (2026-11-23, status: accepted)

**Decision.** The written specification of the result zip (D-007), with its
format version, is authored and maintained in the waterfall-tools repository,
alongside its Extended HAR schema. This repo implements a producer of that
spec and links to it; it does not hold a second copy.

**Context.** Chosen by the project owner during M0 triage over "this repo" and
"its own repo". The viewer's parser is the reference consumer, and other
producers will look for the format where the viewer is documented. A spec
with a version field and a validator was confirmed in the same triage.

**Consequences.** A format change is a waterfall-tools change first; capture
code follows the published spec, never the reverse. Until the spec exists
there, artifact-writing work here is blocked or provisional. Where the
validator code lives is not fixed by this entry.

**Reopen if.** Third-party producers appear and the spec needs governance
independent of either project.

## D-010: No accounts except for storage that needs one; no telemetry  (2026-11-23, status: accepted)

**Decision.** Running a test, viewing a result, downloading it, and using
non-Google storage require no account. Google sign-in appears only when the
user chooses Google Drive upload. The site carries no analytics, no error
reporting, and no third-party scripts.

**Context.** Decided by the project owner during M0 triage. The original
brief required Google sign-in to run tests as an abuse control; with tests
running on the user's own hardware there is nothing of the project's to
abuse. The owner noted sign-in may return "potentially for rendezvous server
when/if that is ever implemented".

**Consequences.** Failures in the field are invisible unless a user sends the
diagnostics log, which therefore has to be good and must only leave the
machine by the user's own action. Third-party provider SDKs loaded from a
provider's CDN would count as third-party scripts — prefer calling provider
HTTP APIs directly, and treat any unavoidable provider script (for example a
sign-in library) as an exception to record.

**Reopen if.** Rendezvous or hosted runners come into scope (sign-in), or the
owner wants usage numbers (cookieless page analytics was the considered
alternative).

## D-009: Isolation is user-selectable with an Auto default; results say what was done  (2026-11-23, status: accepted)

**Decision.** The user may select any installed browser as the test target
and chooses how aggressively its state is cleared. The default is **Auto**:

- *Android:* stable Chrome gets only what can be cleared over CDP; test
  channels (Canary / Dev / Beta, or a browser the tool installed) get a full
  app-data wipe between runs.
- *Desktop extension:* a fresh incognito window per run when the extension is
  allowed in incognito; otherwise the normal profile with a CDP-level clear.

The user can override Auto in either direction, including a full wipe of
stable Chrome. Every result records the isolation actually applied.

**Context.** Decided by the project owner during M0 triage, in their words:
"Allow for any browser to be selected and for the user to opt into the level
of wiping. Default to an Auto mode that just clears over CDP for stable and
full wipe for test channels", and for desktop "Incognito + fallback but also
allow explicit user direction".

**Consequences.** A destructive wipe of a browser the user lives in never
happens by default — only by explicit choice, which the UI must make
unmistakable. Results from different isolation levels are not equivalent, so
the manifest's environment block must carry the applied level, not the
requested one. Repeat-view loads must be exempt from wiping. What a
"CDP-level clear" actually clears (cache, cookies, and what else — socket
pools, DNS, service workers) is to be established by S1 and S3 and stated
precisely in the spec.

**Reopen if.** The spikes show a CDP-level clear is too weak to be worth
labelling as a cold start, or that incognito cannot be driven from the
extension.

## D-008: Results go to user-provided storage; four first targets  (2026-11-23, status: accepted)

**Decision.** The project operates no result storage. A finished test artifact
stays in the user's browser until the user sends it somewhere they control.
The first upload integration covers four targets: **Google Drive** (using only
the `drive.file` OAuth scope), **local download**, an **S3-compatible bucket**
(R2 / S3 / GCS with user-supplied credentials or pre-signed URLs), and
**Dropbox**.

**Context.** Stated by the project owner: the original brief says the artifact
is "stored as a zip in user-provided storage (integration with Google drive,
dropbox, maybe cloud storage with API keys)", and all four targets were
selected at kickoff. The motivation is the lesson from running
webpagetest.org: centralized storage and scaling were the operational burden
this project exists to avoid. The `drive.file`-only restriction was part of
the option the owner selected; the supporting claim from the brainstorm (that
broader Drive scopes trigger Google's restricted-scope verification and a
recurring security assessment) has not been checked against a current source.

**Consequences.** Every storage provider must work from a static page with no
backend of ours (D-001): browser-side OAuth flows, direct browser-to-bucket
uploads, and bucket CORS are the user's and the provider's to satisfy. A
published link dies if the owner deletes the file — accepted. Which targets
can yield a link that a *different* person's browser can fetch is an open
question (features.md Q6), not something this decision promises. Order of
implementation across the four is a plan matter, not fixed here.

**Reopen if.** A target cannot be driven from a backend-less page; the
`drive.file` scope proves insufficient for upload plus link sharing; or the
owner decides to operate storage after all.

## D-007: The result artifact is a new manifest-based zip  (2026-11-23, status: accepted)

**Decision.** A test result is a single self-contained `.zip` in a new, open
format: a `manifest.json` describing the test and its capture environment,
plus per-run payload files (trace, netlog, video and so on). The capture side
writes this format; it does not emit the legacy wptagent result layout.

**Context.** Chosen by the project owner at kickoff over "wptagent-compatible
zip" and "decide in M0". The brainstorm's rationale: one artifact contract
decouples execution, storage, and visualization, and lets other tools produce
results the viewer can open. The selected option described the format as
`manifest.json` with an environment block, `runs/N/` trace / netlog / video
entries, and STORE-mode entries for already-compressed payloads — that is the
intended direction, not a frozen layout.

**Consequences.** waterfall-tools does not read this format today, so a new
waterfall-tools input parser is a hard cross-repo dependency for any viewing
path (features.md, "Cross-repo dependencies"). The exact layout, manifest
fields, versioning, and where the spec document lives are M0 work (Q5). Once
artifacts are published in the wild the format is expensive to change — it
needs a version field from v0.

**Reopen if.** The M0 spec work shows that extending the wptagent layout would
get viewing working materially sooner without giving up what the manifest
buys; or waterfall-tools cannot reasonably ingest the new format.

## D-006: Rendering belongs to production waterfall-tools; two result modes  (2026-11-23, status: accepted)

**Decision.** This project does not render waterfalls. Results are displayed
by the production waterfall-tools viewer, reached in two ways, both of which
must exist: (a) **embedded** — the capture page hosts the live
`waterfall-tools.com` viewer in an iframe and hands it the result
cross-origin via `postMessage`; (b) **published** — the result is uploaded
(D-008) and the user gets a shareable waterfall-tools URL. Which mode a
finished test goes to by default is a user-selectable setting.

**Context.** Stated by the project owner: "it should use the production
waterfall-tools for rendering", and at kickoff: both iframe + postMessage and
a "publish" path, with the default selectable. Verified in the waterfall-tools
repo on 2026-11-23: the viewer's existing iframe API is a same-origin global
(`iframe.contentWindow.WaterfallViewer.loadData(...)`), which
`capture.waterfall-tools.com` cannot reach on `waterfall-tools.com`.

**Consequences.** Mode (a) needs a new `postMessage` load API in the
waterfall-tools viewer and permission for the capture origin to frame it; mode
(b) needs the viewer to load the new artifact format from wherever it was
published. Both are waterfall-tools changes, tracked as cross-repo
dependencies. No copy of the viewer is bundled or self-hosted here — a pinned
npm copy was considered and not chosen. The owner also floated sharing local
storage between the two sites; that is a `proposed` feature with a real
platform caveat (Q4), not part of this decision.

**Reopen if.** Cross-origin handoff of large results proves unworkable; or
the embedded viewer cannot be made frameable without weakening
waterfall-tools.com's own security posture.

## D-005: Repo scope is the capture side; first runners are Chrome-only  (2026-11-23, status: accepted)

**Decision.** This repository covers the capture side of the system: the
in-browser testing UI, capture from an attached Android device over WebUSB,
extension-driven capture in the user's local browser, upload integration, and
the waterfall-tools viewer integration. The first two runners are Chrome on an
attached Android device and Chrome on the local desktop. Explicitly deferred:
the agent rendezvous / pooled-agent / work-queue model, hosted fallback test
machines, the shared-link edge proxy, and non-Chrome browsers (Firefox,
Safari, iOS).

**Context.** Stated by the project owner in the kickoff request (the five
areas above) and in the brainstorm: "First prototypes will be with Android and
Extension so we can flesh out the rendezvous model later". The owner also
judged iOS over WebUSB impractical without a helper process.

**Consequences.** Runner code should sit behind an interface narrow enough
that a later remote-agent runner can be added, but no rendezvous, queueing, or
agent-protocol code is written here until a new decision brings it into scope.
Features that depend on the deferred pieces (for example a shareable link for
a Drive-hosted result, which may need the edge proxy) must say so rather than
assume the piece exists.

**Reopen if.** The owner brings a deferred area into this repo, or the two
Chrome runners prove insufficient to validate the artifact and upload flow.

## D-004: Vanilla JS, ESM only, current stable Chromium, no polyfills  (2026-11-23, status: accepted)

**Decision.** Mirror the waterfall-tools conventions: vanilla JavaScript, ES
modules only, no UI framework, no TypeScript build step, no transpilation, no
polyfills. Types are expressed in JSDoc. Lint is ESLint; tests are vitest. The
capture UI targets current stable Chromium-based desktop browsers only.

**Context.** Selected by the project owner at kickoff ("Vanilla JS, ESM only"
and "Latest stable browsers"). WebUSB and `chrome.debugger` are
Chromium-only, so a wider browser target would buy nothing for capture.

**Consequences.** Dependencies must be usable as plain ESM. Feature detection
with a clear "unsupported browser" message replaces polyfills. Note the two
different version questions this does *not* settle: the minimum Chrome version
of the browser *being tested* (which may need capabilities newer than stable —
Q1), and the bundler / build tooling (an M0 toolchain call).

**Reopen if.** A required dependency only ships in a form that needs a build
transform the owner is unwilling to add; or type errors become a recurring
source of defects that JSDoc checking is not catching.

## D-003: AI-developed, human-directed, human-committed  (2026-11-23, status: accepted)

**Decision.** AI agents write almost all code and docs, working from the
project documentation. The human owner directs, decides, reviews, and is the
only committer: agents never run `git commit` / `git push` or rewrite
history. The process is the lean one in [workflow.md](workflow.md) — one
agent, one pass, human commit; reviews on demand.

**Context.** Chosen by the project owner by scaffolding the repo with this
workflow. No project weight beyond a personal/community tool at prototype
stage was stated, so the lean process applies.

**Consequences.** The docs are the project's long-term memory and must stay
accurate. Every hand-off is an uncommitted working tree plus a short note.

**Reopen if.** The project gains outside contributors, real users depending on
it, or hard-to-reverse deploys — at which point mandatory reviews may be
warranted.

## D-002: Apache-2.0, permissive dependencies only  (2026-11-23, status: accepted)

**Decision.** The project is licensed Apache-2.0. Dependencies must be under
MIT, BSD, Apache-2.0, ISC, or MPL terms. No GPL-family license in any form.

**Context.** The Apache-2.0 `LICENSE` was in the owner's initial commit; the
dependency policy was selected by the owner at kickoff and matches
waterfall-tools. Candidate dependencies checked against npm package metadata
on 2026-11-23: `@yume-chan/adb` 2.6.4 (MIT), `@yume-chan/adb-daemon-webusb`
2.3.2 (MIT), `@yume-chan/scrcpy` 2.3.0 (MIT), `@zip.js/zip.js` 2.25.0
(BSD-3-Clause), `client-zip` 2.5.1 (MIT), `fflate` 0.8.3 (MIT), `mp4box`
2.6.0 (BSD-3-Clause). None of these is adopted by this entry — the check only
establishes they are *eligible*.

**Consequences.** Every new dependency's license is checked against the
package's own metadata before it is added (training knowledge is unreliable
here), including anything pushed to a device (for example a scrcpy server
binary, which has its own license separate from the JS client).

**Reopen if.** A capability with no permissively licensed implementation
becomes essential.

## D-001: Static site on Cloudflare, no backend; tests run on the user's hardware  (2026-11-23, status: accepted)

**Decision.** The capture tool ships as static assets on Cloudflare at
`capture.waterfall-tools.com`. It has no backend of its own: no server-side
test execution, no database, no server-side result storage. Tests execute on
hardware the user provides (their phone, their browser).

**Context.** Stated by the project owner: the goal is a webpagetest-style
tool that "can run without hosted infrastructure (or at least storage and
minimal infrastructure)", motivated by having been "responsible for
centralized infrastructure and scaling" for webpagetest.org; Cloudflare
hosting and the hostname were confirmed at kickoff.

**Consequences.** Anything that would need a server — OAuth code exchange
with a client secret, a CORS proxy, abuse controls, cross-device state — is
either done in the browser, pushed to a service the user already has, or is a
new decision. `capture.waterfall-tools.com` is same-site with but a different
origin from `waterfall-tools.com`: cookies scoped to the parent domain can be
shared, but origin-keyed storage and script access cannot (see Q4).

**Reopen if.** A must-have capability cannot be built without a small
stateless service (the brainstorm's edge proxy is the likeliest candidate); a
service that stores nothing would be a smaller departure than one that does.
