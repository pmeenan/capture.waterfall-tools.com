# Feature matrix

The scope ledger for the M0 planning conversations. Three tiers:

- **Confirmed** — stated project scope. Milestone assignment happens in
  [plan.md](plan.md) as the plan firms up.
- **Proposed** — candidate additions awaiting a yes/no from the project owner.
- **Open questions** — things that shape architecture and need an answer
  during M0.

Status legend: `confirmed` · `proposed` · `rejected (D-NNN)`

**Where rows came from.** `confirmed` rows are things the project owner said:
in the kickoff request, the kickoff answers, their own turns of the
brainstorming transcript, or the triage of 2026-11-23 (marked *triage*). Rows
marked *(brainstorm)* are techniques the AI assistant suggested in that
transcript; rows marked *(agent)* were added while scaffolding. **Every
specific platform claim that originated in the brainstorm is unverified** —
CDP method names, adb commands, Chrome version numbers, quota behavior —
whether its row is confirmed or proposed. Verify against a current source or
a spike before building on one.

A `confirmed` row confirms the *capability* as project scope. Whether it ships
in the first release or after it is set by the release cut (D-012) and the
ladder in [plan.md](plan.md), not by this ledger. Where its Notes name a
mechanism, that mechanism is the current intent and still subject
to the open question it cites. Rows still `proposed` after triage are waiting
on a spike result, not on the owner.

## Capture UI (the site)

| Feature | Status | Notes |
| --- | --- | --- |
| In-browser testing UI at `capture.waterfall-tools.com` | confirmed | Static page; configure a test, pick a runner, run it, get a result. D-001, D-005. |
| Runner choice: attached Android device or local browser | confirmed | The two first runners. D-005. |
| Selectable default result mode (view embedded vs publish) | confirmed | Owner: "let the default mode be selectable". D-006. |
| Capability preflight | confirmed | *triage.* Detect WebUSB support, extension presence and version, and whether the target Chrome supports each capture feature; explain what is missing instead of failing mid-run. |
| Live run progress and cancel | confirmed | *triage.* Phase-level status during a run; cancel must still restore device/browser state. |
| Connection profile presets | confirmed | *triage.* Named throttling profiles in the classic WebPageTest style (cable, 4G, 3G, ...), mapped onto whatever throttling engine the runner has. |
| Multiple runs with median pick | confirmed | *triage.* Run N times and select the median run. Which metric defines the median is a design detail. |
| First view / repeat view | confirmed | *triage.* A warm-cache load after each first view. Interacts with the isolation policy (D-009): repeat view must not be wiped. |
| Device emulation for desktop runs | confirmed | *triage.* Mobile viewport / UA / touch emulation when testing in the local desktop browser. |
| CPU throttling with per-machine calibration | confirmed | *triage.* Short benchmark on first setup to derive a machine-specific multiplier rather than a fixed 4x. |
| Local result history | confirmed | *triage.* Keep recent results in the browser (OPFS / IndexedDB) so they can be re-opened or published later. Interacts with Q4. |
| Open / re-publish an existing artifact | confirmed | *triage.* Drop in a result zip to view or publish it without re-running. |
| Capture diagnostics log | confirmed | *triage.* Exportable log of adb / CDP steps for a failed run. Must not leave the machine on its own (D-010). |
| Scripted / multi-step tests, custom headers, blocked hosts | confirmed | *triage.* Classic WebPageTest test options. The largest item on this list; the scripting language and command set are undefined — see Q9. |
| No analytics or telemetry | confirmed | *triage.* No analytics, error reporting, or third-party scripts on the site. D-010. |

## Android capture over WebUSB

| Feature | Status | Notes |
| --- | --- | --- |
| Test Chrome on an attached, unrooted Android device from the page | confirmed | Over WebUSB, no local helper process. D-005. Feasibility details in Q1. |
| Accurate network throttling via Chrome's socket-layer emulation | confirmed | Raised by the owner: recent Chromium changes move DevTools emulation into the socket layer — close to netem, Chrome-only. Which Chrome versions and how it is switched on: Q1. |
| Video capture using Chrome's native screen recording | confirmed | Raised by the owner (the `paulirish/chrome-capture` work). Whether it is available on Chrome for Android is unverified: Q1. |
| Real NetLog capture on Android | confirmed | Owner's intent, stated conditionally: a Chrome mechanism for reading command-line switches from a non-root location "could solve the real netlog case if it is enabled". Feasibility: Q2. |
| ADB-over-WebUSB transport via Tango ADB | confirmed | *triage.* `@yume-chan/adb` + `@yume-chan/adb-daemon-webusb` (MIT, checked — D-002) rather than a home-grown ADB implementation. |
| Local `adb` conflict detection and guidance | confirmed | *triage.* A running local adb server claims the USB interface; detect the failure and tell the user what to do. |
| Any installed browser selectable, with user-chosen wipe level | confirmed | *triage.* Default "Auto": stable Chrome gets a CDP-level clear only, test channels get a full app-data wipe. D-009. |
| Offer to install a test browser from hosted APK packages | confirmed | *triage, added by the owner.* Both open-source Chromium builds and official Chrome channel builds, the latter subject to a redistribution check. Package source, hosting, and install mechanics: Q10. |
| Guaranteed device cleanup | confirmed | *triage.* Whatever a run changes on the phone (debug-app setting, command-line file, pulled files) is restored on success, failure, cancel, and next connect after an unplug. |
| Test on the device's real radio | confirmed | *triage.* An unthrottled mode that records the actual cellular / Wi-Fi connection as the "profile". |
| Device picker and wake/unlock handling | confirmed | *triage.* Choose among installed browsers; detect a locked or sleeping screen before a run. |
| Command-line switches without the manual flag | proposed | *(brainstorm)* Setting the test browser as the system debug app as an alternative to the `chrome://flags` toggle. Waiting on S2. |
| Video fallbacks when native recording is unavailable | proposed | *(brainstorm)* `adb shell screenrecord`, or a scrcpy stream decoded with WebCodecs. Only if S1 says native recording is missing. |

## Extension-driven capture in the local browser

| Feature | Status | Notes |
| --- | --- | --- |
| Capture in the user's local browser, driven by an extension, in a dedicated tab | confirmed | Owner's kickoff scope. The extension source lives in this repo. D-005. |
| Accurate network throttling via Chrome's socket-layer emulation | confirmed | Same owner-raised capability as on Android; desktop availability and version: Q1. |
| Video capture using Chrome's native screen recording | confirmed | Same owner-raised capability; reachability from an extension: Q3. |
| Incognito isolation with fallback and user override | confirmed | *triage.* Default: fresh incognito window per run when the extension is allowed in incognito, otherwise the normal profile with a CDP-level clear; the user can direct either explicitly. D-009. What `chrome.debugger` can control in incognito: Q3. |
| Managed-profile detection | confirmed | *triage.* Enterprise policy can block debugger attach; detect and explain. |
| Chrome Web Store distribution at first release | confirmed | *triage.* Load-unpacked during development, a store listing for the first public release. Gives a fixed extension ID; every update waits on store review, so the site must tolerate older extension versions. |
| CDP access through `chrome.debugger` | proposed | *(brainstorm)* The obvious mechanism for an MV3 extension; the page/extension split is still open. Waiting on S3. |
| NetLog-level detail through the trace `netlog` category | proposed | *(brainstorm)* The owner confirmed there is no active Chrome work on a CDP NetLog API, so desktop depth has to come from what ships today. Event coverage versus a real NetLog: waiting on S1. |
| Filmstrip from trace screenshots as a fallback | proposed | *(brainstorm)* The `devtools.screenshot` trace category if native recording is unavailable. Waiting on S1. |

## Result artifact

| Feature | Status | Notes |
| --- | --- | --- |
| Single self-contained result `.zip` in a new manifest-based format | confirmed | D-007. Layout and fields: Q5. |
| Environment / provenance block in the manifest | confirmed | Runner, throttling engine, profile isolation actually applied (D-009), browser build — so results captured different ways are not compared blindly. Exact fields: Q5. |
| Written spec with a format version, and a validator | confirmed | *triage.* The spec lives in the waterfall-tools repo (D-011). Where the validator code lives follows the spec. |
| STORE-mode entries for already-compressed payloads | proposed | *(brainstorm)* Lets a reader fetch the zip directory and individual members with HTTP Range requests. Part of the Q5 design. |
| Video-to-trace clock sync marker | proposed | *(brainstorm)* A recorded color flip paired with a trace mark so the viewer can align video time with trace time. Needed only if the recording carries no usable timestamps; waiting on S1. |

## Upload and publish

| Feature | Status | Notes |
| --- | --- | --- |
| Upload to Google Drive | confirmed | `drive.file` scope only. D-008. The only place Google sign-in appears (D-010). |
| Local download | confirmed | No account needed. D-008. |
| Upload to an S3-compatible bucket | confirmed | R2 / S3 / GCS; user-supplied credentials or pre-signed URLs. D-008. |
| Upload to Dropbox | confirmed | D-008. |
| "Publish" produces a shareable waterfall-tools URL | confirmed | D-006. Which storage targets can back a link another person's browser can load, and what that needs, is Q6 — this row does not promise all four. |
| Publish warning and optional redaction | confirmed | *triage.* Traces and NetLogs can contain cookies, auth headers, and response bodies. Warn before anything leaves the machine; a strip-sensitive-fields option alongside. What redaction can honestly guarantee needs defining before it is offered. |
| Resumable uploads with retry | confirmed | *triage.* Results with video and NetLog can be tens of MB. Applies where the provider supports it. |
| Provider settings stored locally | proposed | *(agent)* Bucket config and tokens live only in the browser; never sent anywhere but the provider. Where secrets are kept is part of Q6; waiting on S5. |

## Viewer integration

| Feature | Status | Notes |
| --- | --- | --- |
| Embedded view: live `waterfall-tools.com` viewer in an iframe, fed by `postMessage` | confirmed | D-006. Needs a waterfall-tools change. |
| Published view: open the shareable URL in waterfall-tools | confirmed | D-006. |
| No renderer in this repo | confirmed | D-006. |
| Locally stored results readable by both sites | proposed | Floated by the owner at kickoff ("could also allow"). Not as simple as shared storage: see Q4. Waiting on S4. |
| Hand-off without re-upload ("open in full viewer") | proposed | *(agent)* From the embedded view, open the same result full-page on waterfall-tools.com. Waiting on S4. |

## Cross-repo dependencies (waterfall-tools)

Not features of this repo, but nothing here is viewable without them. They are
work items for the waterfall-tools project and need the owner's scheduling.

| Dependency | Needed by | Notes |
| --- | --- | --- |
| Artifact format spec document | every producer and the parser | D-011: the spec is authored in the waterfall-tools repo. |
| Input parser for the new manifest zip | every viewing path | D-007. Must handle multi-run and first/repeat view results. |
| `postMessage` load API in the viewer, plus permission for the capture origin to frame it | embedded view | D-006. Today's API is a same-origin global. |
| Loading a published result by reference (for example a Drive file id) | published view | Shape depends on Q6. |
| Fetch-proxy format sniff updated for the new zip | published view via proxy | The existing waterfall-tools Worker only proxies formats it recognises. |
| Filmstrip / video display and visual metrics | video capture being worth anything | Mentioned by the owner as a probable waterfall-tools addition. |

## Out of scope for now

Deferred by D-005; listed so nobody rebuilds them here by accident: agent
rendezvous and pooled agents, work queues, hosted fallback test machines, the
shared-link edge proxy, BYO CI runners and a local CLI/Docker agent, Firefox,
Safari, and iOS. If a rendezvous service is ever built, sign-in for it is
expected (D-010).

## Open questions (answer during M0)

Ordered by how much work a late answer would invalidate. Spike names refer to
[plan.md](plan.md). Numbers are stable — answered questions keep theirs.

1. **What can be captured from Chrome on an unrooted Android phone over
   WebUSB, and from which Chrome version?** Reaching the DevTools socket,
   tracing with the `netlog` category, socket-layer throttling, and native
   screen recording each need confirming on a real device. Several are new
   enough that the browser *under test* may need to be newer than stable,
   which changes the setup story (and is part of why the APK install feature
   exists). The same version question applies to desktop. *Spike S1.*
2. **Can a real NetLog be captured on unrooted Android?** How command-line
   switches get applied (flag versus debug-app), a path Chrome can write and
   the adb shell can read, and getting a complete file rather than a truncated
   one. If this fails, Android falls back to trace-level netlog like desktop.
   *Spike S2.*
3. **Where does capture logic live for the extension runner?** Either the page
   owns one CDP capture pipeline shared by both runners and the extension is a
   thin bridge, or the extension runs the capture itself. Hinges on MV3
   service-worker lifetime during a multi-run test lasting many minutes,
   moving tens of MB of trace and video between extension and page, and
   whether screen recording and incognito control work through
   `chrome.debugger`. *Spike S3.*
4. **How does a result get from the capture origin to the viewer origin?**
   `capture.waterfall-tools.com` and `waterfall-tools.com` are same-site but
   different origins. OPFS, IndexedDB, and the Cache API are keyed by origin,
   so being same-site does not by itself give either page the other's storage.
   A `waterfall-tools.com` iframe inside the capture page is same-site with
   its top-level page, so it should receive waterfall-tools.com's ordinary
   first-party storage rather than a partitioned copy — which would let the
   embedded viewer act as the bridge that writes a result where the full
   viewer can later read it. To confirm by experiment, along with the
   `postMessage` contract, transfer of large buffers, and the framing
   permission. *Spike S4.*
5. **What exactly is artifact v0?** Layout, manifest and environment fields,
   versioning, and per-run structure for multi-run and first/repeat view
   results. Must be settled jointly with the waterfall-tools parser. *Design
   task, not a spike.* (Where the spec lives is answered: D-011.)
6. **Which storage targets can back a link someone else can open, with no
   backend of ours?** Per target: can a static page complete auth, can the
   uploaded file be made public, and can another origin's browser fetch it
   (CORS, redirects, interstitials, quotas)? The brainstorm's expectation is
   that buckets work directly and Drive and Dropbox need an edge proxy that is
   out of scope (D-005). Also: where user credentials are kept. *Spike S5.*
7. *Answered 2026-11-23 — cold-state policy: user-selectable with an Auto
   default.* See D-009. What each wipe level can technically achieve is still
   covered by S1 and S3.
8. *Answered 2026-11-23 — sign-in only for Drive upload; no telemetry.* See
   D-010.
9. **Test model details.** Multi-run with median and first/repeat view are
   confirmed; still open are the median metric, how video is aligned to the
   trace clock (S1), and the scripting model — whether to adopt WebPageTest's
   script commands, a subset, or something else, and how custom headers and
   blocked hosts map onto CDP.
10. **Test-browser install from APKs.** Whether official Chrome channel APKs
    may be re-hosted at all (if not, that half becomes a hand-off to the
    store); where Chromium builds come from and who keeps them current; where
    packages are hosted given file sizes and the static-hosting model (D-001);
    and whether install over WebUSB ADB handles modern multi-package Chrome
    installs. *Spike S6.*
