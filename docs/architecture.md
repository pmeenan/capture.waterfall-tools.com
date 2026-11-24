# Architecture

> **Status: first full draft (2026-11-23), not yet reviewed by the owner.**
> Written at the end of the M0 spikes. Everything under "Fixed points" is
> backed by a decision. Everything under "Design" is the scaffolding agent's
> proposal for how to build to those decisions — module names, interfaces,
> and the repository layout are proposals until the owner has walked this
> document; the toolchain is settled (D-025). Evidence is cited as RE-NNN
> ([rough-edges.md](rough-edges.md)); choices as D-NNN
> ([decisions.md](decisions.md)).

## 1. What the system is

A static web page at `capture.waterfall-tools.com` that runs a page-load test
on hardware the user controls, turns what it captured into one result file,
shows that file in the waterfall-tools viewer, and optionally publishes it to
storage the user owns. Nothing is hosted by the project beyond static files.

```
                 capture.waterfall-tools.com (static page)
  +---------------------------------------------------------------------+
  |  Test UI -> Run controller -> Capture pipeline -> Artifact builder  |
  |                                 |                    |       |      |
  |                         CDP transport (one of)       |       |      |
  |       +-------------------+-----+------------+       |       |      |
  |       | ADB socket        | extension port   | helper WS     |      |
  +-------|-------------------|------------------|-------|-------|------+
          | WebUSB            | chrome.runtime   | loopback      |
          v                   v                  v       |       |
     Android phone       this browser,      a dedicated  |       |
     (Chrome over ADB)   via the thin       Chrome the   |       |
                         bridge extension   helper runs  |       |
                                                         v       v
                                            waterfall-tools   user's storage
                                            viewer (iframe,   (download, Drive,
                                            or published URL) bucket, Dropbox)
```

## 2. Fixed points (from decisions)

- **Static site, no backend**; tests run on the user's hardware. (D-001)
- **Three runners, all Chrome**: Android over WebUSB, the local browser
  through an extension, and a dedicated Chrome launched by an `npx` helper.
  Remote agents, queues, hosted runners and other browsers are out of scope.
  (D-005, D-017)
- **One output contract**: a single manifest-based result zip, whose spec
  lives in the waterfall-tools repo. (D-007, D-011)
- **No renderer here**: the production viewer shows results, embedded and fed
  by `postMessage`, or opened by a published URL. No shared local storage
  between the two origins. (D-006, D-020)
- **User-provided storage only**: download, Google Drive (`drive.file`),
  S3-compatible bucket, Dropbox. (D-008)
- **Isolation is the user's choice with an Auto default**, and the result
  records what was actually applied. (D-009)
- **No accounts except for Drive; no telemetry or third-party scripts.**
  (D-010)
- **Throttling is DevTools emulation**: socket-layer where the browser has
  it, request-level otherwise; never refuse a run over it; record which
  applied. (D-013)
- **Android video** is `screenrecord` behind wptagent's orange cover by
  default, trace screenshots as an option; the capture side analyses the
  recording and the artifact keeps the raw file. (D-014, D-021)
- **Android NetLog** is plain JSON ended by force-stop. (D-016)
- **The extension is a thin, guarded CDP bridge**; the pipeline lives in the
  page. It cannot provide netlog in its trace. (D-018, D-019)
- **Anything listening on loopback is a security boundary**, with one shared
  set of guards for the dev bridge and the helper. (D-015, D-022)
- **Vanilla JS, ESM, current stable Chromium, no polyfills.** (D-004)
- **The first release** is all three runners capturing, viewing and
  publishing; the test model, breadth items and scripting follow. (D-012)

## 3. Design

### 3.1 Layers

From the top down. Each layer knows only the one below it.

1. **Test UI.** Configuration, runner choice, preflight, progress, result
   actions. Holds no capture logic.
2. **Run controller.** Turns a test configuration into one or more page-load
   runs and collects their outputs. In the first release it does a single
   run; multiple runs, first/repeat view, median selection and scripted steps
   are added here later without touching the layers below (D-012).
3. **Capture pipeline.** The sequence for one page load: prepare state,
   apply throttling, start trace and video, navigate, decide when the load is
   over, stop, collect. Written once, against a CDP transport and a runner
   capability description.
4. **Runner.** Supplies the transport and everything outside CDP that its
   environment needs or offers — device state, switches, video source,
   NetLog retrieval — and declares its capabilities.
5. **CDP transport.** `send(method, params, sessionId)` plus an event
   stream, and nothing else.

Alongside the stack: the **artifact builder**, **video analysis**, **storage
providers**, the **viewer hand-off**, and the **local result store**.

### 3.2 The CDP transport and what differs between runners

All three runners end at a Chrome that speaks CDP, but through different
doors:

| | Android (WebUSB) | Extension | Helper (`npx`) |
| --- | --- | --- | --- |
| Path to CDP | Tango ADB → `localabstract:chrome_devtools_remote` → WebSocket framing written by the page (RE-007) | `chrome.runtime.connect` port → `chrome.debugger` (RE-011) | loopback WebSocket → helper → debugging pipe (RE-014) |
| Session scope | browser-level and page-level | tab-level only | browser-level and page-level |
| Throttling engine | socket-layer on 160.0.8167+ (the runner always supplies the switch), else request-level (RE-001) | request-level until Chrome enables the feature by default | socket-layer where the launched Chrome has it |
| Trace | page-level or browser-level | tab-level: no netlog events (RE-010) | browser-level with netlog, or page-level |
| Real NetLog | yes, via command-line switch and file pull (RE-009) | no (D-019) | yes; complete after a clean close (RE-014) |
| Video | `screenrecord` + orange cover; trace screenshots opt-in; native recording unavailable (RE-002, RE-006) | native recording, AV1 MP4 | native recording, AV1 MP4 |
| Isolation (Auto) | test channels: app-data wipe; stable: cache only, cookies never deleted unasked (D-027) | incognito if allowed and no other incognito window is open; otherwise the normal profile, asking whether to delete cookies or clear cache only (D-027) | new temporary profile per run |
| Known distortion | the recording shows the whole display; analysis crops it | the debugging bar takes 56 px off the viewport at attach | none observed |
| What the user must do | stop any local adb; approve the device chooser and, once, the on-phone prompt | install the extension; optionally allow it in incognito | run the helper; allow Chrome's loopback permission once |

Two rules follow:

- **The pipeline is written against tab-level sessions.** Whatever only a
  browser-level session can do — netlog in the trace, browser-wide tracing —
  is an optional capability the runner declares, never an assumption.
- **A trace is started on the page session when screenshots are wanted and on
  the browser session when netlog is wanted.** On desktop no single trace has
  both; on the test phone a page-level trace had both, which may not hold on
  other phones (RE-010).

Every CDP call the pipeline makes must be on the **shared allowlist**
(§3.9). The Android transport does not need the allowlist for safety — the
page talks to the phone directly — but using one list everywhere keeps the
three runners honest about being the same pipeline.

### 3.3 Timing

The capture page is hidden for most of a test: behind the tab under test,
behind the helper's Chrome window, or just covered by another window. Chrome
then delays its timers by up to a second, and after five minutes by up to a
minute, while messages and worker timers stay punctual (RE-015).

So the pipeline never calls `setTimeout` to wait. It reacts to CDP events
and, where it needs a delay or a timeout, uses a small **worker-backed
clock** shared by all runners.

### 3.4 One page load, step by step

The same sequence for every runner; steps in *italics* are runner-specific.

1. **Preflight.** Check the transport is up, read the browser version, and
   resolve capabilities — for Android, from the browser's own
   `/json/protocol` and version (RE-003).
2. ***Save state.*** Android: read the device's debug-app setting and
   command-line file so they can be put back (RE-005).
3. ***Apply isolation.*** Per D-009 and the table above.
4. ***Launch with switches.*** Android: write the command-line file, set the
   debug app, start the browser, wait for the DevTools socket by polling
   (it appears seconds after launch — RE-003). Helper: launch on the
   debugging pipe with a temporary profile. Extension: create the test tab
   or incognito window.
5. **Attach** and enable the `Page` and `Network` domains.
6. **Apply throttling** with `Network.emulateNetworkConditionsByRule`.
7. **Start the trace** on the session that fits what was asked for (§3.2).
8. ***Start video.*** Desktop: `Page.startScreenRecording` with the real
   viewport size (the default is 800x600 — RE-002). Android: paint the orange
   cover, start `screenrecord`, wait for it to be recording (D-014).
9. **Navigate.** Android with screenrecord: remove the cover and navigate
   inside two animation frames, as wptagent does.
10. **Wait for the end of the load** by the rule of D-028: the load event,
    then 2 seconds with no request in flight (WebSockets, event streams and
    requests open longer than 10 seconds do not count), within a 120 second
    limit; a failed navigation ends the run at once. Every ending keeps what
    was captured and records how the run ended.
11. **Stop video, then the trace**, and read both back through `IO.read`.
12. ***Collect what lives outside CDP.*** Android: stop `screenrecord` and
    pull the file; force-stop the browser and pull the NetLog (D-016). Helper:
    close the browser cleanly and read the NetLog.
13. **Detect what actually applied**: the throttling engine, from connection
    setup time against the configured latency (RE-001) — recorded as unknown
    when that cannot tell the two engines apart, never guessed; the isolation level;
    the trace scope; the video source. Timing alone is weak on a low-latency
    preset, a reused connection or a resumed QUIC session, so where the
    runner knows the browser version and whether it passed the switch
    (Android, helper) those narrow the answer first and timing confirms it;
    only the extension, which knows neither, rests on timing.
14. ***Restore state.*** Put back anything step 2 saved, delete files left on
    the device, close tabs and windows — on success, failure and cancel
    alike, and again on the next connect if a run was cut off (AGENTS.md
    rule 11).
15. **Hand the payloads and the environment description** to the run
    controller.

**Counting requests for step 10.** "No request in flight" is easy to get
wrong in ways that only show as a run sitting out the 120 second limit:

- Keep the open requests in a map keyed by request id, with the start time
  and type of each — not a counter. A redirect sends
  `Network.requestWillBeSent` again for the *same* id, so a counter climbs
  and never comes back down.
- A request leaves the map on `loadingFinished` or `loadingFailed`. Requests
  answered from `data:` URLs or the memory cache may never send either, and
  must not be entered in the first place.
- A failed navigation means the *main frame's* document request failed.
  `net::ERR_ABORTED` on it is usually the page replacing its own navigation
  (`location.replace`, a meta refresh) and is not a failure; the same error
  on a subresource is a cancelled request and nothing more.
- WebSockets and event streams are recognised by resource type
  (`WebSocket`, `EventSource`) and, for a stream fetched some other way, by
  a `text/event-stream` response.

The controlled test pages of M2 exist to pin each of these down.

### 3.5 Android device layer

Everything in the Android runner sits on a Tango ADB `Adb` object and does
not care how it was obtained:

- **Production:** WebUSB — device chooser, interface claim, key
  authentication with the browser's own key (RE-007).
- **Production, alternative:** the desktop adb server through the helper,
  when the user opts in (D-023).
- **Development and automated tests:** the same adb-server route through the
  dev bridge (D-015, RE-008).

On top of `Adb` it provides: shell commands, file push and pull, opening the
DevTools socket, spawning `screenrecord`, and the save/restore of device
state. The WebSocket and CDP framing over the raw ADB socket is this
project's code (RE-007).

Open points carried into implementation: the NetLog output path is only
proven on a phone with SELinux permissive (RE-009), and installing a test
browser from packages is deferred (Q10).

### 3.6 The extension

A Manifest V3 extension whose service worker is a relay and holds no state
that matters between runs (D-018):

- accepts `chrome.runtime.connect` only from the capture origin;
- creates and closes the tabs or incognito windows a test uses, and attaches
  the debugger only to those;
- forwards allowlisted CDP commands and the resulting events;
- answers a version handshake.

The service worker stays alive while a debugger is attached and is stopped
when idle with only a port open, so the page reconnects before each run and
never assumes the port survived (RE-011). Payloads cross the port as base64
in chunks well under the 64 MiB message limit (RE-011).

The site-to-extension message set is a published interface: store review
means installed extensions lag the site, so it is versioned from the first
release, and the site must work with the previous extension version.

### 3.7 The local helper

A small Node program published to npm (D-017, D-022):

- binds to `127.0.0.1` on a port chosen at start, prints a link to the
  capture site whose fragment carries the port and a per-run secret;
- on a WebSocket upgrade checks `Host`, `Origin`, then the secret in the
  first message; one paired connection at a time; no plain-HTTP surface;
- launches Chrome on the debugging pipe with a temporary profile and the
  switches a test needs, relays allowlisted CDP, and closes the browser and
  deletes the profile when the run or the pairing ends;
- remembers the targets it created and refuses `Target.attachToTarget` and
  `Target.closeTarget` for any other — the helper's version of the
  extension's "own tabs only" (D-018). The allowlist checks method names; it
  cannot know whose target an id is, so the relay has to;
- drops a connection that has not sent the secret within a couple of
  seconds, so that an unpaired tab cannot sit on the single connection slot.

On the page's side, the pairing fragment is read and then removed from the
address bar with `history.replaceState` before anything else happens, so it
is not left in a screenshot or a copied URL. Still to decide in M2: whether
a secret pairs once or for as long as the helper runs, and where the page
keeps it for a reconnect once the fragment is gone.

The URL filter allows any `http(s)` address, local and private ones
included; that is deliberate (D-030).

The capture page reaches it only after the user grants Chrome's
loopback-network permission; until then the connection simply waits, so the
UI has to recognise and explain that state (RE-014).

The dev bridge of D-015 is the same program in a different mode, not a second
implementation: same binding, same checks, same relay filter.

The helper also offers an attached phone through the desktop adb server, in
the first release (D-023). Unlike CDP this cannot be allowlisted — an adb
connection includes a shell — so it sits behind its own opt-in. That gate is
designed in M3, before the dev bridge carries a phone, so that no unguarded
mode is ever built and then has to be reworked for the release.

Also not designed yet: how the helper finds a Chrome on each operating
system.

### 3.8 Video

- **Desktop** (extension and helper): Chrome's native recording produces an
  AV1 MP4, read back over CDP (RE-002). Whether its timeline needs aligning
  to the trace has not been tested.
- **Android, default:** `screenrecord` behind the orange cover. After the
  run the capture page analyses the file — a small MP4 demuxer, WebCodecs
  decoding, orange detection, the crop rectangle taken from the cover's
  extent, and near-duplicate removal — and writes the start offset, crop
  rectangle and kept-frame times to the manifest. The raw MP4 goes into the
  artifact (D-021, RE-013). The video clock starts 30–70 ms late, about
  200 ms on a cold first load; the manifest records the method so this can be
  improved later.
- **Android, opt-in:** trace screenshots. Already on the trace clock and
  content-only, but they slow the load measurably and stop silently when the
  frame budget runs out (RE-004, RE-013).

### 3.9 The shared CDP allowlist

One module, used in three places, lists the CDP methods the pipeline may call
and the URL schemes it may load:

- the pipeline, so it cannot grow a dependency the extension or helper would
  refuse;
- the extension's relay;
- the helper's relay.

It exists because an unfiltered relay is local-file read for whoever is
paired — demonstrated in RE-014 — and because `chrome.debugger` in a user's
real profile is at least as sensitive. Adding a method to the list is a
security change and is reviewed as one.

### 3.10 Artifact builder

Assembles the manifest and payloads into the result zip in the browser. The
format is specified in the waterfall-tools repo (D-011); this module is one
producer of it. What it has to be able to express, from the decisions so far:

- per run: the trace, the NetLog if any, the video if any;
- an environment block: runner, browser build, throttling engine that
  applied (D-013), isolation applied (D-009), trace scope (RE-010), video
  source and alignment method (D-014);
- video analysis results (D-021);
- room for multiple runs and repeat views from the first version, although
  the first release writes one run (D-007, D-012).

Members are stored in the zip uncompressed, so that a reader can fetch one
with a range request (confirmed as a requirement; the spec has to carry it).
That only pays if each member is already compressed: the trace and the
NetLog are gzipped by the pipeline before they reach the builder, which
refuses either one otherwise. A NetLog is tens of megabytes of JSON and
shrinks about tenfold.

Open, for the spec work: the layout itself, and whether a force-stopped
NetLog is stored as pulled or with its closing brackets appended (D-016).

A whole result can still reach tens of megabytes, and the builder today
makes the archive as one array in memory, which is then copied into a
`Blob`. Whether payloads are held in memory or streamed to the capture
origin's OPFS while a run is in progress is an implementation choice to make
with real numbers. Two limits on the viewer's side bound a published result
today: its fetch proxy refuses a body over 100 MiB, and refuses `Range`
requests, so range reads work only against storage the browser fetches
directly.

### 3.11 After the run: viewing, keeping, publishing

- **Viewing.** The capture page frames the viewer and posts the result to it
  as a transferred buffer (D-020, RE-012). The viewer's side of that — an
  open `postMessage` load — is a waterfall-tools change. The openness runs
  one way only. The viewer accepts a result from any embedder; the capture
  page, which holds traces with cookies in them, posts only to the viewer's
  exact origin — never `*`, and in production never an origin taken from a
  URL parameter. `frame-src` in `site/public/_headers` names the production
  viewer and nothing else; when the viewer built from the submodule is
  tried locally, the development and preview servers add its loopback
  origin as they serve, so that it never reaches the deployed policy.
- **Keeping.** Results the user keeps live in the capture origin's own
  storage and are posted to the viewer again when re-opened (D-020). Storage
  credentials and settings stay in the browser too. Local
  history is a post-first-release feature (D-012), but the result store's
  shape should not preclude it.
- **Publishing.** A storage provider uploads the zip and, where the target
  allows it, returns a reference the viewer can load for anyone with the
  link (D-006, D-008, D-020). One interface, four implementations. Which
  targets can produce such a link without a backend, and where credentials
  are kept, are unanswered until spike S5 (Q6). A warning precedes every
  publish: results can contain cookies and credentials, and a raw Android
  recording shows the whole display (D-021).

### 3.12 Look and feel

The capture page and the viewer are meant to read as one product, so the
capture page takes its look from the viewer rather than having a design of
its own. The source of truth is the viewer's stylesheet,
`waterfall-tools/src/viewer/style.css`:

- `site/src/app.css` copies the viewer's custom properties, font stack and
  landing-page rules (the grey backdrop, the centred white card, the logo,
  the heading and tagline, the feature cards, the primary button, the GitHub
  link, the 768px breakpoint) under the same class names. Each copied rule is
  marked `viewer:` with the rule it came from, so drift shows up in a diff.
- New capture UI reuses a viewer pattern when one exists — the viewer's URL
  field and joined button for the test URL, its header and tabs once there
  is more than one view — and only then adds something of its own, in the
  viewer's colours.
- The logo and favicon in `site/public/` are copies of the viewer's. Nothing
  is imported from the submodule (D-029).
- The viewer has no dark theme, so the capture page has none. If the viewer
  gains one, capture follows it.

Two places where capture departs on purpose: keyboard focus rings, which the
viewer does not draw, and small grey text one step darker than the viewer's
`#777`, which falls short of 4.5:1 on white.

## 4. Trust boundaries

- **The capture origin is the trust anchor** for both the extension and the
  helper: whoever can serve script from it can run tests through them, within
  the allowlist. The site's deploy access, its dependencies, and the
  no-third-party-scripts rule are therefore security controls (D-010, D-018,
  D-022).
- **The extension** trusts only that origin, only its own tabs, and only
  allowlisted methods (D-018).
- **The helper** trusts only that origin, a loopback `Host`, the per-run
  secret, and allowlisted methods (D-022).
- **Captured data is untrusted.** Traces, NetLogs, response bodies and page
  content come from arbitrary sites: treat them as data, never interpolate
  them into the capture page's DOM unescaped.
- **Captured data is sensitive.** It can hold the user's cookies and
  credentials for the tested site. Nothing leaves the machine without an
  explicit user action (D-008). A fresh profile keeps the user's own session
  out of a result. Incognito does so only when no other incognito window is
  open, since a new one would share that session; the extension runner
  checks, and falls back to the normal profile when it is not fresh (D-027).
- **Nothing in the user's own browser is deleted without being asked.**
  Clearing cookies is profile-wide, so it needs explicit consent, and that
  consent has to be held where a compromised page cannot forge it (D-027).
- **The viewer hand-off is open by design**: any embedder may post a result
  to the viewer, and the viewer treats it as untrusted input (D-020).

## 5. Repository layout

npm workspaces, built with Rollup and served by Vite in development (D-025).
The workspace folders are decided; what goes inside each is still this
draft's proposal:

| Path | Contents |
| --- | --- |
| `site/` | The capture page: UI, run controller, runners, storage providers, viewer hand-off |
| `shared/` | Code used by more than one deliverable: the CDP allowlist, message contracts, the pipeline if the helper ever needs it |
| `extension/` | The MV3 bridge |
| `helper/` | The `npx` helper and dev bridge |
| `tests/` | Unit tests and the agent-driven integration harnesses |
| `scripts/` | Build, local preview with production headers, licence gate, deploy |
| `docs/` | This documentation |

Three deliverables ship from one repository: static files to Cloudflare, an
extension to the Chrome Web Store, and a package to npm. Their versions are
independent, and the two message contracts between them are what must stay
compatible.

## 6. Testing

- **Unit tests** (vitest) for everything that is pure: the MP4 demuxer and
  video analysis against recorded files, the WebSocket framing, the
  allowlist, the artifact builder, manifest generation.
- **Agent-driven integration, no person needed**, all demonstrated in M0:
  the Android runner through the dev bridge against a phone or emulator
  (RE-008); the extension loaded with CDP `Extensions.loadUnpacked` over a
  debugging pipe, with a fresh profile per run (RE-011, RE-015); the helper
  paired from a real HTTPS page with the loopback permission granted through
  CDP (RE-014).
- **A manual checklist** for what automation cannot reach: the WebUSB
  chooser, interface claim and on-phone prompt; a competing adb server;
  unplug and reconnect; Chrome's loopback permission prompt as a user sees
  it; the Web Store build's fixed extension id.
- **Continuous integration** (D-025) runs lint, the `tsc` type check, unit
  tests, the build, the licence gate, and the two desktop integration paths
  in headless Chrome. Android is not in CI: the phone run through the dev
  bridge and the manual checklist are the gate for that code. Recorded-session
  fakes or an emulator job remain possible later.

## 7. What this project needs from waterfall-tools

waterfall-tools is a git submodule of this repository (D-029), so these can
be developed and tried together locally; each still lands by the owner's
commit in that repository, and the product still uses the production viewer.
Tracked as rows in [features.md](features.md); listed here because the
architecture does not work without them:

- the artifact spec and a parser for it, including multi-run structure;
- an open `postMessage` load in the viewer;
- loading a published result by reference, full-page or embedded;
- showing video from a raw recording plus manifest metadata, which needs
  H.264 and AV1 decoding in whatever browser opens the result;
- scoping a whole-session NetLog to the tested page, unless the capture side
  does it;
- continuing to tolerate an unterminated NetLog.

## 8. Open questions

Unanswered, in rough order of how much design they could move:

1. **The artifact format** (Q5) — everything in §3.10 hangs on it.
2. **Publishing without a backend** (Q6, spike S5) — which targets yield a
   shareable link, and where credentials live.
3. **Android on a stock phone** — the NetLog path and other file-access
   results were obtained with SELinux permissive (RE-009).
4. **Who computes visual metrics** — the capture side already decodes every
   frame (D-021).
5. **Video decoding in the viewer outside Chrome** (D-021).
6. **The rest of the test model** (Q9). The end of a single load is settled
   (D-028). Alignment of desktop recordings to the trace clock is untested
   and gets a spike before M5.
7. **Finding Chrome for the helper on macOS and Linux** (RE-014).
8. **Whether the capture page can be frozen or discarded** by Chrome's
   energy or memory savers during a long run (RE-015).
9. **Whether the site needs a service worker** at all, given what it does to
   cache-busting.
10. **How the site finds the extension** when a store build and an unpacked
    build have different ids.
11. **How a test's script is shown to the user before it runs in a
    signed-in profile.** `Runtime.evaluate` stays on the shared allowlist
    for every runner (D-031); in the extension's normal-profile fallback
    that makes the capture origin's integrity the only thing between a test
    and the user's signed-in sites. Part of the scripting design (Q9).
