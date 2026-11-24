# Plan

**This is a living document.** Milestones will be re-scoped, re-ordered, split,
or added as planning conversations and findings come in. That churn is
expected; what is *not* allowed is silent change. Scope changes get a
decision-log entry; progress is reflected here by checking boxes and updating
status lines as work lands.

Check a box only when the item is done and verified; partially done items stay
unchecked, optionally with a note.

**Status legend:** `pending` · `in progress` · `done` · `parked`

## M0 — Plan the plan  `done`

Goal: turn the brainstorm and the kickoff answers into a settled vision,
feature matrix, architecture, and milestone ladder — through planning
conversations with the project owner plus targeted spikes where a decision
needs evidence.

- [x] Repo scaffolding for the AI-directed workflow (this scaffold).
- [ ] Feature triage: walk [features.md](features.md) with the owner; promote
      or reject every `proposed` row; answer the open questions; record
      significant calls in [decisions.md](decisions.md).
      *First pass done 2026-11-23:* every product-level row was promoted to
      `confirmed`, one feature was added (test-browser install from APKs),
      Q7/Q8 were answered, and the first release was cut after publishing
      (D-009..D-012). A
      second pass the same day settled the last seven proposed rows (D-023,
      D-024): no row is `proposed` any more. Still open as questions: Q5, Q6,
      Q9, Q10, plus the stock-phone half of Q2 and the remainder of Q12.
- [x] **Spike S1 — Android capture capability matrix (Q1).** On a real
      unrooted phone over WebUSB: reach Chrome's DevTools socket, record a
      trace with the `netlog` category, apply socket-layer throttling, start
      native screen recording. Output: a table of capability × Chrome channel
      / version (works / fails / needs flag), and the same table for desktop
      Chrome. Throw-away code; findings go to
      [rough-edges.md](rough-edges.md).
      *Done 2026-11-23.* Desktop
      (Windows): Chrome 157 stable and 160.0.8180.0 Canary, headless, over
      the remote-debugging port. Phone (moto g play 2023, Android 13, arm32):
      Play builds of stable 157.0.8103.78, Beta 159.0.8154.18, Dev
      160.0.8171.0, Canary 160.0.8180.0, over `adb forward` (not WebUSB),
      without using root. Results:

      | Capability | Desktop | Android | Notes |
      | --- | --- | --- | --- |
      | Reach DevTools socket, drive CDP | works | works on all four channels | also verified end to end over WebUSB; RE-007 |
      | Trace with `netlog` category | works | works | 60–80 netlog event types on a simple page |
      | `Tracing.recordClockSyncMarker` | works | works | — |
      | Request-level throttling | works (157, 160) | works (157, 159, 160) | the fallback of D-013 |
      | Socket-layer throttling | works on 160 with the switch | works on Dev and Canary 160 with the switch | not in 157 or 159; RE-001 |
      | Command-line switches without root | n/a | works via debug-app + command-line file | RE-005; first half of S2 |
      | Native screen recording | works (157, 160), AV1 MP4 | **fails on 157, 159, 160** | Android builds lack the AV1 encoder; RE-002 |
      | Trace screenshots | not retested | works when tracing is started on the page session | full resolution within a frame budget; RE-004 |
      | `adb shell screenrecord` | n/a | works, H.264, no measurable overhead | whole display, no clock link; RE-006 |
      | Isolated browser context | works | works on Play builds | failed only on a Chromium 150 dev build; RE-003 |

      The WebUSB transport was then run for real from desktop Chrome 157 on
      Windows with Tango ADB: every step of a full capture pass succeeded on
      the first attempt (RE-007). The Android video path is decided (D-014).
      Not covered, and carried to later work: a phone whose debug-app
      setting was never set, more than one phone model, and macOS / Linux
      hosts.
- [ ] **Spike S2 — Real NetLog on unrooted Android (Q2).** Output: a working
      command sequence (or a documented dead end) covering how switches are
      applied, the output path, and whether the pulled file is complete.
      *Half answered by S1 (RE-005):* switches are applied on Play-installed
      Chrome through the debug-app setting plus the command-line file, with
      no root. *NetLog half run 2026-11-23 (RE-009):* a working sequence
      exists — `--log-net-log=/sdcard/Download/<file>`, stop with
      `am force-stop` (unterminated but line-complete, and waterfall-tools
      reads it) or let `--net-log-duration` finish for a clean file. The
      app-specific external folder is a dead end: adb cannot read the file.
      *Not checked off* because the test phone has SELinux permissive; the
      path results need one confirmation on a stock, enforcing phone. The stop
      method is decided: plain JSON ended by force-stop (D-016).
- [x] **Spike S3 — Extension bridge (Q3).** Output: a recommendation between
      "page owns the capture pipeline, extension is a bridge" and "extension
      runs capture", backed by measurements: a multi-minute CDP session
      surviving MV3 service-worker lifetime, moving a ~50 MB payload from
      extension to page, screen recording and incognito control through
      `chrome.debugger`.
      *Done 2026-11-23 (RE-010, RE-011).* Recommendation: **the page owns
      the capture pipeline and the extension is a thin, stateless CDP
      bridge.** A full pass ran that way in normal and incognito tabs; the
      service worker survived 180 s of silence with a debugger attached
      (and was killed after 75 s with only a port open); 50 MB crossed the
      port in about a second. Cost of the extension route, whichever side
      owns the pipeline: no browser-level session, so no netlog in the
      trace, and the debugging bar shrinks the viewport by 56 px. Adopted
      as D-018, with security precautions.
- [x] Measure hidden-page timer throttling for the extension runner (D-018):
      with the capture page backgrounded behind the tab under test, how late
      do its timers and its handling of bridge messages run over a run of
      several minutes? Decides whether any waits must move into the
      extension.
      *Done 2026-11-23 (RE-015).* Page timers fire once a second while
      hidden and once a minute after five minutes; bridge messages, worker
      timers, and waits done by the extension are unaffected. The pipeline
      takes its time from a dedicated worker, never from page timers.
- [x] **Spike S4 — Cross-origin hand-off and storage bridge (Q4).** Output:
      confirmation (or refutation) that an embedded `waterfall-tools.com`
      frame under the capture page sees waterfall-tools.com's first-party
      storage, plus a sketch of the `postMessage` contract and the framing
      permission it needs.
      *Done 2026-11-23 (RE-012); design decided in D-020.* Contract sketch,
      names provisional — the viewer announces `ready` to its parent; the
      embedding page sends `load` with the result as a transferred
      `ArrayBuffer`; the viewer answers `loaded` or `error` to the sender's
      origin. Open to any embedder; no storing on the viewer side. The
      production viewer sends no framing headers, so none need changing.
      To settle with the waterfall-tools work: message names and
      versioning, and a check on the real domains.
- [ ] **Spike S5 — Publish without a backend (Q6).** Per storage target:
      static-page auth, upload, making the file public, and a cross-origin
      fetch of it from another browser profile. Output: a table of target ×
      (auth ok / upload ok / shareable ok / needs proxy), and where
      credentials are kept.
- [ ] **Spike S6 — Test-browser install from APKs (Q10).** Output: whether
      official Chrome channel APKs may be re-hosted (check the actual terms,
      not memory), a source for Chromium builds, a hosting location that fits
      the file sizes, and a working install of each over WebUSB ADB on a real
      device — or a documented reason it cannot work.
- [x] **Spike S7 — screenrecord processing in the browser (Q11).** Record a
      page load on the phone with the orange-frame start, then in a page:
      demux the MP4, decode with WebCodecs, find the viewport, drop
      near-duplicate frames, and locate the orange-to-content transition.
      Output: whether it works at all, how long it takes for a typical
      recording, how its frame times compare with trace screenshots of the
      same load, and a recommendation on capture side versus viewer. Also
      measure what trace screenshots cost on this slow phone and what happens
      when the frame budget runs out, since that source is opt-in until known.
      *Done 2026-11-23 (RE-013).* It works: a 60-line demuxer plus WebCodecs
      decodes screenrecord output, and orange detection, viewport crop and
      sparse-frame selection run in 1–2 s for a typical recording. The
      video clock starts 30–70 ms late (about 200 ms on a cold first load),
      and a pause before navigating does not fix it. Trace screenshots add
      11–16% to load time on a light page and stop silently when the frame
      budget runs out. Recommendation on where it runs: the capture side
      analyses the recording and writes the start offset, crop rectangle
      and kept-frame times into the manifest; the artifact keeps the raw
      MP4; the viewer decodes only what it shows. Adopted as D-021.
- [x] **Spike S8 — Local helper connectivity and security (Q12).** From the
      deployed-site situation (a public HTTPS origin), open a loopback
      WebSocket to a local process and record what Chrome requires or
      prompts for; prototype pairing (loopback bind, origin check, secret);
      launch a clean-profile Chrome from Node on the debugging pipe and run
      the shared capture pass with a browser-level session. Output: a
      security design the owner can review, and the list of OS-specific
      problems in locating Chrome.
      *Done 2026-11-23 (RE-014).* The design is accepted as D-022. A public HTTPS page can
      reach the helper only after the user grants Chrome's loopback
      permission; pairing by host, origin and secret held against five
      kinds of attempt; a full capture pass ran through it with a
      browser-level trace and a real NetLog. Locating Chrome was only
      exercised on Windows.
- [ ] Artifact v0 draft (Q5): layout, manifest and environment fields
      (including the applied isolation level, D-009, the throttling engine
      that applied, D-013, the video source and alignment method, D-014, and
      the video analysis results — start offset, crop rectangle, kept-frame
      times, D-021),
      version field, per-run structure for multi-run and first/repeat view. Authored in the
      waterfall-tools repo (D-011) and agreed with its parser work before any
      runner writes one.
- [ ] Test-model design (Q9): median metric, and the scripting model — how
      much of WebPageTest's script command set to adopt.
- [ ] Schedule the waterfall-tools cross-repo dependencies with the owner
      (features.md, "Cross-repo dependencies") — at minimum the parser and the
      `postMessage` API, since M2 cannot show a result without them.
- [x] First full draft of [architecture.md](architecture.md).
      *Written 2026-11-23; not yet reviewed by the owner.* Module names, the
      interfaces and the repository layout in it are proposals.
- [x] Toolchain decisions: bundler (or none), extension build and packaging,
      test strategy for hardware-dependent code (the adb-server bridge of
      D-015 for agent-driven runs against a real phone; whether CI uses an
      emulator or recorded-session fakes; the manual WebUSB checklist),
      lint config, CI, Cloudflare deploy path, dependency license audit.
      Record in decisions.md. (Vanilla JS / ESM / ESLint / vitest are already
      fixed by D-004.)
      *Decided 2026-11-23 (D-025):* Rollup + Vite dev, npm workspaces,
      `tsc` as a check only, a licence script in CI, CI with headless
      desktop integration, owner-run deploy script. Android stays out of CI.
- [x] Rewrite the provisional ladder below into real milestones with exit
      criteria.
      *Done 2026-11-23, as a proposal.* The runner order changed (helper,
      then Android, then extension); the owner approved that order.

**Exit criteria:** the owner has walked features.md and says the plan is good
enough to build from; the architecture-blocking open questions (Q1–Q5) are
answered — the rest may ride along as open questions; toolchain decided; M1+
milestones have scopes. M0 is a conversation, not a phase — it exits on the
owner's call, not on a checklist reaching zero.

**Where M0 stands (2026-11-23).** Features are triaged, the toolchain is
decided, and Q1, Q3 and Q4 are answered. Q2 is answered on the test phone
only. **Q5, the artifact format, is not answered**; the ladder lets M1 to M5
proceed on a provisional layout and makes M6 wait for the spec. What was left
was the owner's call.

**M0 exited 2026-11-23.** The owner said the plan is good enough to build
from and started M1. Items still unchecked above — the stock-phone half of
S2, S5, S6, the artifact v0 spec, the test-model design, and scheduling the
waterfall-tools work — ride along as open items against the milestones that
need them (see "What only the owner can unblock").

## Milestone ladder

Rewritten at the end of M0 (2026-11-23) from the spike results. Proposed by the scaffolding agent. **The owner approved the runner order —
helper, then Android, then extension — on 2026-11-23**; the scopes and exit
criteria of the individual milestones have not been reviewed line by line.

Each milestone lists what it delivers, what it is waiting on from outside
this repo, and how to tell it is done. "Verified unattended" means an agent
can run the check with no person present.

### Why this order

The earlier sketch built the extension runner first. This ladder builds the
**helper first**, then Android, then the extension, because:

- the helper's loopback bridge is also the development harness (D-015), so
  building it first gives every later milestone an unattended test loop;
- it needs no phone, no store listing, and no user's browser profile;
- it gives a browser-level session, the most complete of the three, so the
  pipeline is written once against the richest case and then narrowed to the
  shared allowlist for the others.

Building the helper early does not mean publishing it early: it is not
released until the security review in M8.

### M1 — Foundation  `in progress`

Scope: npm workspaces and the D-025 toolchain; CI with lint, type check, unit
tests, build and the licence gate; the owner-run deploy script with a dry
run; a static shell of the capture page. The shared pieces every runner
needs: the worker-backed clock (RE-015), the CDP allowlist, the CDP client
over an abstract transport, WebSocket framing for the ADB socket, and an
artifact builder that writes a provisional layout.

- [ ] Workspaces, build, lint, type check, vitest, licence gate.
- [ ] CI on pull requests.
- [ ] Deploy script with dry run; README check commands.
- [ ] Capture page shell with preflight scaffolding and a place for results.
- [ ] Worker-backed clock; CDP allowlist; CDP client; WebSocket framing.
- [ ] Artifact builder (provisional layout) and local download.

Waiting on: nothing to start. The artifact layout stays provisional, and is
labelled as such in what it writes, until the spec exists (Q5, D-011).

**Exit criteria:** CI is green on a pull request; the shell is reachable at
the production URL after the owner deploys it; the page builds a result zip
from a canned trace and saves it, and that trace converts with the published
waterfall-tools command-line tool; unit tests cover the clock, the allowlist
and the framing.

### M2 — Helper runner and the capture pipeline  `pending`

Scope: the helper program — pairing, the D-022 guards, the filtered relay,
launching Chrome on a debugging pipe with a temporary profile — and the
first version of the capture pipeline: attach, trace, navigate, end of load,
collect, restore. Preflight for the helper, including Chrome's loopback
permission states; run progress and cancel.

Waiting on: nothing.

**Exit criteria:** an agent runs a test of a public URL through the helper
unattended and gets a result whose trace converts with waterfall-tools; the
guard tests of RE-014 (wrong origin, wrong secret, foreign `Host`, no
`Origin`, abuse through the relay) run in CI and pass; a test proves the
pipeline calls nothing outside the allowlist; cancelling mid-run leaves no
browser process and no temporary profile behind.

### M3 — Android runner  `pending`

Scope: obtaining an `Adb` connection over WebUSB and over the dev bridge;
the device layer — save and restore of device state, launch with switches,
DevTools socket discovery, file pull; the same pipeline over the ADB socket
transport; the browser picker; guidance when a local adb server holds the
phone.

Waiting on: a phone attached to the development machine. For a public claim
of support: one pass on a stock phone with SELinux enforcing (RE-009).

**Exit criteria:** an agent runs a test on the phone through the dev bridge
unattended and gets a result whose trace converts with waterfall-tools; the
phone's debug-app setting and command-line file are byte-identical after a
successful run, a failed run, and a cancelled run; the owner has walked the
manual WebUSB checklist once — chooser, on-phone prompt, competing adb
server, unplug and reconnect.

### M4 — Extension runner  `pending`

Scope: the MV3 bridge with the D-018 guards — capture origin only, own tabs
only, allowlisted methods, version handshake; the port-based transport with
reconnect; incognito with fallback and the user's override; chunked
transfer of payloads.

Waiting on: nothing to build. A fixed extension id needs the Web Store
listing, which comes in M8.

**Exit criteria:** a CI job loads the extension over a debugging pipe and
runs a test in a normal tab and in an incognito window; the bridge refuses a
connection from another origin, a tab it did not create, and a method off
the allowlist; a run survives the service worker being stopped between runs.

### M5 — Capture fidelity  `pending`

Scope: throttling with connection presets, and detection of the engine that
actually applied (D-013); video — native recording on desktop,
`screenrecord` behind the orange cover on Android with capture-side
analysis, trace screenshots as the opt-in (D-014, D-021); NetLog on Android
and through the helper (D-016); the isolation levels of D-009; a complete
environment block.

Waiting on: the artifact spec for the final names of what is recorded (Q5).

**Exit criteria:** on each runner a result carries a trace, video where the
runner supports it, and an environment block whose throttling engine,
isolation level, trace scope and video source match what was done — checked
in tests by running the helper with and without the throttling switch;
Android video analysis reproduces the RE-013 results on recorded files in
unit tests; a NetLog pulled from the phone converts with waterfall-tools.

### M6 — View  `pending`

Scope: the embedded viewer and the `postMessage` hand-off (D-020); the
selectable default result mode; the artifact builder moved from the
provisional layout to the published spec.

Waiting on, from waterfall-tools: the artifact spec and its parser, and the
open `postMessage` load in the viewer. **This milestone cannot finish
before those ship.**

**Exit criteria:** a result from each runner appears in the embedded
production viewer without leaving the machine; the artifact validates
against the published spec.

### M7 — Publish  `pending`

Scope: the storage providers — download, Google Drive, S3-compatible bucket,
Dropbox — in the order spike S5 recommends; "publish" returning a shareable
viewer link where the target allows; the publish warning and optional
redaction; resumable uploads; provider settings kept in the browser.

Waiting on: spike S5, which needs the owner's OAuth client ids and accounts
(Q6); from waterfall-tools, loading a published result by reference.

**Exit criteria:** for each storage target the owner has uploaded a result;
for at least one target a published link opens the result in waterfall-tools
in a different browser profile (the vision's criterion is one target, not
four); nothing is uploaded without the warning having been shown.

### M8 — First release  `pending`

Scope: the helper's opt-in route to a phone through the adb server and its
gate (D-023); the security review of the helper and the extension that D-017
requires; the Chrome Web Store listing; the npm package; public
documentation; the manual checklists.

Waiting on: the owner's review and sign-off of the security design in
practice; store review; npm publishing rights.

**Exit criteria:** the security review is written down and its findings are
closed or accepted by the owner; the owner has run, on each of the three
runners, a test from the production site through to an embedded view and a
published link; the store listing and npm package are live.

**— first release (D-012, D-017, D-023) —** Everything below is confirmed
scope that ships afterwards.

### M9 — Test model  `pending`

Multiple runs with median selection, first view / repeat view, CPU
throttling with calibration, device emulation for desktop runs, real-radio
mode on Android. Starts with the test-model design (Q9).

### M10 — Breadth  `pending`

Local result history, opening an existing result, the diagnostics log,
test-browser install from packages (spike S6, Q10), managed-profile
detection, and packet capture and TLS key logging through the helper.

### M11 — Scripting  `pending`

Scripted multi-step tests, custom request headers, blocked hosts.

### What the first release does not defer

- The artifact format must have room for multiple runs and first / repeat
  view from its first version, because it is expensive to change once
  results are published (D-007).
- The first release has no diagnostics log and no telemetry (D-010), so
  failures in the field will be hard to diagnose; D-012 names that as a
  reason to pull the diagnostics log forward.

### What only the owner can unblock

| Item | Blocks |
| --- | --- |
| Review of the architecture draft and of this ladder | M0 exit |
| Artifact v0 spec, authored in the waterfall-tools repo (Q5, D-011) | M6, and final field names in M5 |
| waterfall-tools: parser for the spec, open `postMessage` load, load by reference | M6, M7 |
| Spike S5: OAuth client ids and accounts for Drive and Dropbox (Q6) | M7 |
| A stock Android phone for one confirmation pass (RE-009) | public Android claims in M3 and M5 |
| Web Store developer account and npm publishing rights | M8 |
