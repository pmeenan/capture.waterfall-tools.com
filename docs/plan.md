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
      D-024): no row is `proposed` any more. On 2026-11-24 Q2's stock-phone
      half (RE-020), Q6 (S5, RE-021) and the rest of Q12 (RE-022) were
      answered. Still open as questions: Q5 (the artifact format), Q9 (the
      test model), and Q10's install over WebUSB (S6).
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
- [x] **Spike S2 — Real NetLog on unrooted Android (Q2).** Output: a working
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
      *Confirmed on a stock phone 2026-11-24 (RE-020):* on a Pixel 11 with
      Android 17 and SELinux enforcing, Chrome stable (targetSdk 36) wrote
      and adb pulled a NetLog in `/sdcard/Download`, in the same shape as
      RE-009. **New:** Beta, Dev and Canary (targetSdk 37) ignore the
      command-line file on Android 17 unless `chrome://flags`
      `#enable-command-line-on-non-rooted-devices` is on. Decided (D-032):
      it is turned on only with the user's consent, then left on.
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
      Message names and versioning were settled in M2 as protocol 1 of
      waterfall-tools' `embed-api.js`. Still to check: the real domains.
- [x] **Spike S5 — Publish without a backend (Q6).** Per storage target:
      static-page auth, upload, making the file public, and a cross-origin
      fetch of it from another browser profile. Output: a table of target ×
      (auth ok / upload ok / shareable ok / needs proxy), and where
      credentials are kept.
      *Drive started 2026-11-24.* The owner made an OAuth client and an API
      key, and the spike page is in the session scratchpad. Sign-in was
      blocked in Testing mode: the owner's account could not be added as a
      test user ("not eligible for designation as a test user"), cause
      unknown. The route taken is publishing the app to production. With
      `drive.file` alone that should need no Google review, but it does need
      a home page, privacy policy and terms on the authorized domain
      `waterfall-tools.com`. Those pages are drafted in the waterfall-tools
      submodule (its Phase 19) and wait on the owner's commit and deploy.
      *Drive done 2026-11-24 (RE-021)*, after the owner put the privacy
      policy and terms on waterfall-tools.com and published the app:

      | Target | Auth | Upload | Shareable | Needs proxy |
      | --- | --- | --- | --- | --- |
      | Google Drive | ok: GIS token popup, `drive.file`, about 1 h token in page memory | ok: resumable, 120 MB in 30 s | ok: "anyone with link" and a Drive API fetch with a public API key, CORS and `Range`, 120 MB with no interstitial | no |

      The keyless `drive.usercontent.google.com` route is not usable from a
      page: curl sees CORS headers, but Chrome does not. Links will open
      through the waterfall-tools `/fetch` proxy instead (D-034). *Checked off
      2026-11-24 on the owner's call:* Drive answers the spike. The
      S3-compatible and Dropbox targets are tested when M7 builds them.
- [ ] **Spike S6 — Test-browser install from APKs (Q10).** Output: whether
      official Chrome channel APKs may be re-hosted (check the actual terms,
      not memory), a source for Chromium builds, a hosting location that fits
      the file sizes, and a working install of each over WebUSB ADB on a real
      device — or a documented reason it cannot work.
      *Mostly run 2026-11-24 (RE-019).* Official Chrome APKs may not be
      re-hosted (Google and Play terms), so those channels become links to
      Play. Chromium snapshots (BSD-3) come straight from Google's
      `chromium-browser-snapshots` bucket, whose JSON API URL allows CORS
      and `Range`. A page can pull one APK out of the zip and inflate it in
      about 1.5 s. Nothing needs hosting, and Cloudflare's 25 MiB file limit
      would rule it out anyway. Install through adb's streamed install
      worked first time for a 159 MB snapshot APK, in 12 s. With the owner's
      go-ahead, ChromePublic 160.0.8182.0 then replaced the phone's Chromium
      150 build. It installed in 15 s, and CDP, the command-line file,
      isolated contexts and a browser-level trace all worked. The DevTools
      socket only opened once first run was disabled. *Not checked off:* the
      install has not run over WebUSB.
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
- [x] Schedule the waterfall-tools cross-repo dependencies with the owner
      (features.md, "Cross-repo dependencies") — at minimum the parser and the
      `postMessage` API, since M2 cannot show a result without them.
      *Scheduled 2026-11-24.* The owner's rule: "postMessage should be built
      at the start of the milestone that needs it". That is the start of M2,
      before the helper work. The first parser version is already part of
      M2's scope. The full-spec parser belongs to M6 and load by reference
      to M7, the milestones that list them.
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

### M1 — Foundation  `done`

Scope: npm workspaces and the D-025 toolchain; CI with lint, type check, unit
tests, build and the licence gate; the owner-run deploy script with a dry
run; a static shell of the capture page. The shared pieces every runner
needs: the worker-backed clock (RE-015), the CDP allowlist, the CDP client
over an abstract transport, WebSocket framing for the ADB socket, and an
artifact builder that writes a provisional layout.

- [x] Workspaces, build, lint, type check, vitest, licence gate.
- [x] CI on pull requests and on pushes to main. *Green on GitHub on
      2026-11-24 for commit `4bd1845`, a push to main
      (`.github/workflows/ci.yml`). It also fails on a dependency with a
      known vulnerability (`npm audit`).*
- [x] Deploy script with dry run; README check commands. *First deploy
      2026-11-24: commit `fe50fa3` is live at
      `https://capture.waterfall-tools.com/`, with its custom domain set in
      `wrangler.jsonc`. The `workers.dev` address is off.*
- [x] Capture page shell with preflight scaffolding and a place for results.
- [x] Worker-backed clock; CDP allowlist; CDP client; WebSocket framing.
- [x] Artifact builder (provisional layout) and local download. *The page
      builds the sample result and offers it through a download link under
      the production Content-Security-Policy; the link itself was not
      clicked during verification.*

Waiting on: nothing to start. The artifact layout stays provisional, and is
labelled as such in what it writes, until the spec exists (Q5, D-011).

**Exit criteria:** CI is green on GitHub, on a push to main or a pull request; the shell is reachable at
the production URL after the owner deploys it; the page builds a result zip
from a canned trace and saves it, and that trace converts with the published
waterfall-tools command-line tool; unit tests cover the clock, the allowlist
and the framing.

**Status 2026-11-23.** Built and passing locally: 97 unit tests (131 after the two reviews of 2026-11-24), lint, type
check, build, licence gate (after D-026), deploy dry run. The trace inside a
built artifact converts with the published waterfall-tools package (checked
through its library entry point in a unit test). Two exit criteria are the
owner's to complete: a push for CI to run on, and a first deploy so
the shell is reachable at the production address. *2026-11-24:* CI is
green on GitHub, and the first deploy is live. On the production URL the page
built the sample result (76,354 bytes, a 2,354-event trace) under the
production CSP and offered it for download; the download itself was not
clicked. **M1 is done.** Found on the live site and fixed the same day:
Cloudflare had been injecting its Web Analytics beacon into both sites
(RE-023).

### M2 — Helper runner, capture pipeline, and a first result in the viewer  `pending`

Scope: the helper program — pairing, the D-022 guards, the filtered relay,
launching Chrome on a debugging pipe with a temporary profile — and the
first version of the capture pipeline: attach, trace, navigate, end of load,
collect, restore, ending a run by the rule of D-028. Preflight for the
helper, including Chrome's loopback permission states; run progress and
cancel.

Added after the review of 2026-11-24:

- **A first result in the viewer.** Alongside the helper, agree a minimal
  artifact format and take one result from the helper into the embedded
  viewer: the format's first version and its parser, and the open
  `postMessage` load, are written in waterfall-tools through the submodule
  (D-029, D-011, D-020). **The `postMessage` load comes first in M2**, per
  the owner's rule that it is built at the start of the milestone that
  needs it. This is the part of the old "View" milestone that
  does not depend on the other runners.
- **Controlled test pages.** A local test server with pages whose behavior
  is known in advance: a fixed set of requests, redirects, resources
  delayed by known amounts, a connection that stays open, a navigation that
  fails.

Added after the second review of 2026-11-24, accepted by the owner:

- **A minimal diagnostics log**, pulled forward from M10: the steps of
  preflight and of each run, kept in memory, with a button to download
  them. With no telemetry (D-010) this is the only way a failed run can be
  reported, and it is cheapest to build with the pipeline. It leaves the
  machine only when the user saves it.
- **A pinned Chrome on Linux CI, checked early.** The CI image ships stable
  Chrome; the socket-layer throttling switch needs 160 or later (RE-001),
  and loading an extension over the debugging pipe has only been seen
  working on Windows Canary 160 (RE-011). Install a pinned Chrome for
  Testing or Dev build in CI and prove the helper's pipe launch on it now,
  so that M4 and M5 do not discover a Linux difference late.

To build in, from the same review (design in architecture.md §3.4, §3.7 and
§3.11): the relay tracks the targets it created and refuses to attach to or
close any other; the page removes the pairing fragment from the address bar
and the helper drops a connection that does not authenticate promptly; the
capture page posts results only to the viewer's exact origin; open requests
are counted by request id, not with a counter. To decide while building:
whether a pairing secret is used once or for the helper's lifetime;
separate type-check settings for page, extension and Node code once
`helper/` has code in it (one `tsconfig.json` covers everything today, so a
Node import in page code would not be caught by the type check); and how
tests reach the artifact parser that lives in the submodule, given that
`package.json` depends on the published waterfall-tools and CI does not
check the submodule out.

Progress:
- [x] **The `postMessage` load in the viewer (2026-11-24).** Built in the
  submodule as protocol 1 (`src/viewer/embed-api.js`, waterfall-tools Phase
  20). The tests include a browser test with a cross-origin parent posting a
  9.5 MB HAR as a transferred buffer. Committed in the submodule
  (`a94d604`); it goes live when the viewer is next deployed.
- [ ] **The helper (started 2026-11-24).** Built so far: the loopback
  server with the D-022 checks, pairing, the control protocol, the filtered
  relay with ownership, finding Chrome, and the pipe launch with a
  throwaway profile. `tsconfig.node.json` type-checks it without the DOM.
  Tests:
  - every RE-014 guard, plus the two new ones: a connection that never
    pairs is dropped, and one connection at a time;
  - the relay refuses targets it did not create, and RE-014's abuse calls;
  - a real headless Chrome driven through the relay, which leaves no
    profile behind on close or when the page goes away.

  **The page's side** (`site/src/helper-connection.js`, `helper-ui.js`):
  - the pairing fragment is removed from the address bar at once and kept in
    `sessionStorage`;
  - the connection waits through Chrome's loopback prompt instead of timing
    out, and reports a denial, a stale link and a stopped helper in words;
  - a CDP transport for the shared client;
  - a "Test the connection" button;
  - the CSP admits `ws://127.0.0.1:*` and nothing else new.

  Run end to end on 2026-11-24: the built site under its production headers,
  the real helper, Chrome stable 157 launched, answered and closed; a reload
  re-paired from `sessionStorage`; no console errors, no profile left. That
  page was on `localhost`, so Chrome's loopback prompt did not appear; the
  prompt path is covered by unit tests only until it runs from the public
  site.

  **The NetLog** (2026-11-24): `launch` takes `netLog: true`. The helper
  picks the path, inside the run's working folder next to the profile. To
  close, the helper itself sends `Browser.close` over the pipe, with an id
  the page can never use, and kills Chrome only after 5 s. The text then
  reaches the page in 1 MiB `netlog` messages before `closed`, whether
  Chrome was closed or exited by itself, and the folder is deleted. With
  real Chrome the result parsed as complete JSON and held the probed URL.

  **The capture pipeline** (2026-11-24, `site/src/capture/`):
  - `page-load.js` runs one load the same way for every runner. It opens a
    tab, starts a browser-level trace with netlog, navigates, ends by D-028,
    and reads the trace back gzipped through `IO.read`. Requests are kept in
    a map by id; the quiet period is timed from events, on the worker clock.
  - `helper-run.js` wraps it for the helper: launch with a NetLog, run,
    close on every path, and package a result zip whose manifest records
    the ending, the timings and where the document ended up.

  The controlled test pages are in `tests/helpers/test-pages.js`. Against
  real headless Chrome every D-028 ending lands where the rule says, within
  0.7 s:
  - a simple page: exactly the four requests the server served;
  - a redirect and a 404 document both complete;
  - a fetch after the load event holds the run;
  - an event stream does not;
  - a request hanging past 10 s stops counting;
  - a page that never goes quiet times out;
  - a refused connection fails the navigation at once;
  - a cancel ends the run and still keeps the trace.

  The pipeline called nothing outside the allowlist, and the trace and
  NetLog from a real result zip both convert with the published
  waterfall-tools. Found on the way: Chrome never finishes a `fetch()` whose
  body is not read (RE-024).

  **The run UI, the embedded viewer and the diagnostics log**
  (2026-11-24):
  - `site/src/run-ui.js`: a URL and a browser, Run and Cancel, each step as
    it starts, the outcome in words, and the result zip to download.
  - `site/src/viewer-embed.js`: frames the viewer and posts the result by
    protocol 1, only to the viewer's exact origin. In production that is
    `https://waterfall-tools.com`. A `?viewer=` override is honoured only
    when the page itself runs on loopback. The CSP's `frame-src` names the
    production viewer; `scripts/preview.js --viewer <origin>` adds a local
    one for that preview only.
  - `site/src/diagnostics.js`: preflight and every run step and error, kept
    in memory and saved only by the user's click. No pairing secret.

  Run end to end the same day: the built site under its production
  headers, the real helper, and the viewer built from the submodule on
  loopback. A run of `https://example.com/` started from the UI
  completed. The result zip was offered, and the waterfall rendered in the
  embedded viewer without leaving the machine. The console had no errors,
  and no temporary folder was left.

  Two caveats:
  - Until the viewer parses the result zip, the page posts only the
    gzipped trace.
  - The browser-level trace includes Chrome's own background requests,
    which show in the waterfall. That is the scoping problem RE-009
    recorded for the NetLog.

  Still to do for M2:
  - the viewer's parser for the result zip, then posting the zip itself;
  - scoping the capture to the tested page;
  - the diagnostics log saving its run's failing step (only the UI paths
    are exercised so far);
  - the dev-bridge mode;
  - a pinned Chrome in Linux CI;
  - checking that the real-Chrome tests run in CI.

Waiting on: the owner's commits in the waterfall-tools repository for the
viewer changes. (The submodule was added on 2026-11-24, pinned at
waterfall-tools `36c2d86`, v0.4-7.)

**Exit criteria:** an agent runs a test of a public URL through the helper
unattended and gets a result whose trace converts with waterfall-tools;
against the controlled pages, the capture contains exactly the requests
the page makes, the run ends where D-028 says it should for each case
(redirect, delayed resource, open connection, failed navigation, the time
limit), and each ending is recorded correctly; the helper launches the
pinned Chrome on the Linux CI image; a failed run's diagnostics log can be
downloaded and says which step failed; that result opens in the
embedded viewer, built from the submodule, without leaving the machine; the
guard tests of RE-014 (wrong origin, wrong secret, foreign `Host`, no
`Origin`, abuse through the relay) run in CI and pass, joined by two more:
the relay refuses to attach to or close a target it did not create, and a
connection that never sends the secret is dropped; a test proves the
pipeline calls nothing outside the allowlist; cancelling mid-run leaves no
browser process and no temporary profile behind.

**Before M3 starts: spike S5 for one storage target** (moved forward by the
review of 2026-11-24). Upload one result and open its shareable link from a
different browser profile. Publishing is a success criterion in the vision
and its answer could change the provider design, so it is tested before two
more runners are built on the assumption that it works. Needs the owner's
account and credentials for that target. *Done for Google Drive on
2026-11-24 (RE-021): it works with no proxy.*

### M3 — Android runner  `pending`

Scope: obtaining an `Adb` connection over WebUSB and over the dev bridge;
the device layer — save and restore of device state, launch with switches,
DevTools socket discovery, file pull; the same pipeline over the ADB socket
transport; the browser picker; guidance when a local adb server holds the
phone; detecting whether a channel applies switches, and the consent prompt
for Chrome's command-line flag where it does not (D-032). Also the **design of the gate for the helper's adb route** (D-023),
moved here from M8 after the second review of 2026-11-24: the dev bridge
and the helper are one program, so the opt-in — proposed as a start-up flag
naming one device, with a plain statement in the terminal — is agreed with
the owner and built before the bridge carries a phone, rather than bolted
onto an unguarded mode at release time.

Waiting on: a phone attached to the development machine; the owner's
agreement to the gate design. For a public claim
of support: one pass on a stock phone with SELinux enforcing was done on
Android 17 (RE-020). It found that Beta, Dev and Canary there need a
Chrome flag before they read switches. It is turned on with the user's
consent and left on (D-032); M3 builds the prompt.

**Exit criteria:** an agent runs a test on the phone through the dev bridge
unattended and gets a result whose trace converts with waterfall-tools; the
phone's debug-app setting and command-line file are byte-identical after a
successful run, a failed run, and a cancelled run; the bridge reaches a
phone only when started with the opt-in, and only the device it names; the
owner has walked the
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

**Before M5 starts: a spike on desktop recording alignment** (added by the
second review of 2026-11-24). Nobody has measured how a
`Page.startScreenRecording` video lines up with the trace clock. If the
recording starts late by a variable amount, as `screenrecord` does on
Android (RE-013), desktop video needs a sync marker or a timestamp
correlation too, and that changes M5's design.

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
in tests by running the helper, on the pinned Chrome that M2 put into CI,
with and without the throttling switch, with
the engine recorded as unknown whenever connection timing cannot tell the
two apart;
Android video analysis reproduces the RE-013 results on recorded files in
unit tests; a NetLog pulled from the phone converts with waterfall-tools.

### M6 — View, the rest  `pending`

The first result in the viewer moved into M2. What remains here: results
from the Android and extension runners in the embedded viewer, video and the
full environment block in the format, the selectable default result mode,
and the artifact builder conforming to the published spec rather than the
minimal first version.

Waiting on, from waterfall-tools: the full artifact spec, and the viewer
changes of M2 being published on the production site. **This milestone
cannot finish before those ship.**

**Exit criteria:** a result from each runner appears in the embedded
production viewer without leaving the machine; the artifact validates
against the published spec.

### M7 — Share, in waterfall-tools  `pending`

**Moved to waterfall-tools by D-036.** The capture site stays local: it posts
results to the viewer and saves them to disk. Sharing is a viewer feature on a
separate share origin, built through the submodule (D-029). It covers anything
the viewer has open.

Scope (all in waterfall-tools):
- **Spike first:** the viewer opens the share popup, both full-page and
  embedded in the capture page, and hands it a large file.
- **The share origin:** a minimal static page with a strict CSP that never
  parses files. It takes files only from the viewer's origin through its
  opener, and uploads only after a click in its own window.
- **The storage providers:** Google Drive first, since S5 proved it
  (RE-021), then S3-compatible and Dropbox, each tested as it is built.
- **Sharing behaviour:** the publish warning and optional redaction;
  resumable uploads; provider settings kept in the share origin's storage;
  a shareable viewer link where the target allows.
- **The viewer side:** a Share action, and the original bytes of every
  loaded file kept as a cache in the viewer's file storage (OPFS), not in
  RAM.
- **The `/fetch` proxy (D-034):** its format sniff learns the result zip, it
  caches published results, and a local `/fetch` for the dev viewer runs the
  same Worker code.

Waiting on: accounts and credentials for the S3-compatible and Dropbox
targets, and the owner's OAuth client updated to the share origin's
JavaScript origin. Google's production requirements for the app are met.

**Exit criteria:** for each storage target the owner has shared a result from
the viewer, including a capture result posted by the capture page; for at
least one target a published link opens the result in waterfall-tools in a
different browser profile (the vision's criterion is one target, not four);
nothing is uploaded without the warning having been shown; no storage
credential is ever readable from the viewer's or the capture site's origin.

### M8 — First release  `pending`

Scope: shipping the helper's route to a phone through the adb server behind
the gate designed and built in M3 (D-023); the security review of the helper and the extension that D-017
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
mode on Android. Starts with the test-model design (Q9). To check first:
each socket-layer throttling profile has its own in-memory HTTP cache
(RE-001), so applying throttling again between the first and the repeat
view could silently throw the warm cache away.

### M10 — Breadth  `pending`

Local result history, opening an existing result, the rest of the diagnostics log
(a minimal one is built in M2),
test-browser install from packages (spike S6, Q10), managed-profile
detection, and packet capture and TLS key logging through the helper.

### M11 — Scripting  `pending`

Scripted multi-step tests, custom request headers, blocked hosts.

### What the first release does not defer

- The artifact format must have room for multiple runs and first / repeat
  view from its first version, because it is expensive to change once
  results are published (D-007).
- The first release has no telemetry (D-010), so failures in the field
  would be hard to diagnose; D-012 names that as a reason to pull the
  diagnostics log forward, and a minimal one now ships in M2.

### What only the owner can unblock

| Item | Blocks |
| --- | --- |
| Review of the architecture draft and of this ladder | Nothing outright: M0 exited without it. Until it happens, the module names, interfaces and per-milestone scopes in both remain proposals |
| Agreement to the design of the helper's adb gate (D-023) | the Android-through-helper part of M3 |
| Commits in the waterfall-tools repository, made through the submodule (D-029) | the viewer part of M2 |
| Artifact spec beyond the minimal first version (Q5, D-011) | M6, and final field names in M5 |
| waterfall-tools: parser for the spec, open `postMessage` load, load by reference | M6, M7 |
| Accounts and credentials for S3-compatible and Dropbox, tested when built (S5 closed on Drive, RE-021) | M7 |
| Web Store developer account and npm publishing rights | M8 |
