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
| Runner choice: attached Android device, local browser via the extension, or the local helper | confirmed | The three first-release runners. D-005, D-017. |
| Selectable default result mode (view embedded vs publish) | confirmed | Owner: "let the default mode be selectable". D-006. |
| Capability preflight | confirmed | *triage.* Detect WebUSB support, extension presence and version, and whether the target Chrome supports each capture feature; explain what is missing instead of failing mid-run. |
| Live run progress and cancel | confirmed | *triage.* Phase-level status during a run; cancel must still restore device/browser state. |
| Connection profile presets | confirmed | *triage.* Named throttling profiles in the classic WebPageTest style (cable, 4G, 3G, ...), mapped onto whatever throttling engine the runner has. |
| Multiple runs with median pick | confirmed | *triage.* Run N times and select the median run. Which metric defines the median is a design detail. |
| First view / repeat view | confirmed | *triage.* A warm-cache load after each first view. Interacts with the isolation policy (D-009): repeat view must not be wiped. |
| Device emulation for desktop runs | confirmed | *triage.* Mobile viewport / UA / touch emulation when testing in the local desktop browser. |
| CPU throttling with per-machine calibration | confirmed | *triage.* Short benchmark on first setup to derive a machine-specific multiplier rather than a fixed 4x. |
| Local result history | confirmed | *triage.* Keep recent results in the capture site's own storage (OPFS / IndexedDB) so they can be re-opened or published later. Re-opening loads the result there and posts it to the embedded viewer (D-020). |
| Open / re-publish an existing artifact | confirmed | *triage.* Drop in a result zip to view or publish it without re-running. |
| Capture diagnostics log | confirmed | *triage.* Exportable log of adb / CDP steps for a failed run. Must not leave the machine on its own (D-010). A minimal version — run steps kept in memory, with a download button — is built in M2; the rest stays in M10. |
| Scripted / multi-step tests, custom headers, blocked hosts | confirmed | *triage.* Classic WebPageTest test options. The largest item on this list; the scripting language and command set are undefined — see Q9. |
| No analytics or telemetry | confirmed | *triage.* No analytics, error reporting, or third-party scripts on the site. D-010. |
| Look and feel matches the waterfall-tools viewer | confirmed | Owner, 2026-11-24: the two should "feel like a coherent product". The viewer's stylesheet is the source of truth; see [architecture.md](architecture.md) §3.12. Light theme only, because the viewer is. |

## Android capture over WebUSB

| Feature | Status | Notes |
| --- | --- | --- |
| Test Chrome on an attached, unrooted Android device from the page | confirmed | Over WebUSB, no local helper process. D-005. Verified end to end by S1 from desktop Chrome on Windows (RE-007). |
| Accurate network throttling via Chrome's socket-layer emulation | confirmed | Raised by the owner: recent Chromium changes move DevTools emulation into the socket layer — close to netem, Chrome-only. S1 verified it on Android Dev and Canary 160 with `--enable-features=SocketLayerNetworkThrottling` supplied through the command-line file (RE-001, RE-005). Builds before 160.0.8167 fall back to request-level throttling (D-013). |
| Video capture on Android | confirmed | Raised by the owner as Chrome's native screen recording (the `paulirish/chrome-capture` work). **S1: not available on Android** — on stable 157, Beta 159, and Canary 160 the command fails because Android builds lack the AV1 encoder (RE-002). Per D-014, Android video comes from `adb shell screenrecord` by default, with trace screenshots as an option. |
| Real NetLog capture on Android | confirmed | Owner's intent, stated conditionally: a Chrome mechanism for reading command-line switches from a non-root location "could solve the real netlog case if it is enabled". S2: it works on the test phone — written to `/sdcard/Download`, pulled over adb, read by waterfall-tools — confirmed on a stock Android 17 phone with SELinux enforcing for stable (RE-020). On Android 17, Beta, Dev and Canary read switches only with Chrome's "command line on non-rooted devices" flag on. |
| ADB-over-WebUSB transport via Tango ADB | confirmed | *triage.* `@yume-chan/adb` + `@yume-chan/adb-daemon-webusb` (MIT, checked — D-002) rather than a home-grown ADB implementation. S1 ran a full capture pass on it without a failure (RE-007). The WebSocket/CDP layer on top of the raw ADB socket is ours to write. |
| Local `adb` conflict detection and guidance | confirmed | *triage.* A running local adb server claims the USB interface; detect the failure and tell the user what to do. |
| Any installed browser selectable, with user-chosen wipe level | confirmed | *triage.* Default "Auto": test channels get a full app-data wipe. Stable Chrome gets the cache cleared and nothing else unless the user agrees to more; whether Android stable follows the desktop prompt exactly is not yet confirmed by the owner. D-009, D-027. |
| Offer to install a test browser from hosted APK packages | confirmed | *triage, added by the owner.* Both open-source Chromium builds and official Chrome channel builds, the latter subject to a redistribution check. Package source, hosting, and install mechanics: Q10. S6 (RE-019) found that the official builds may not be re-hosted. They become links to Play, and Chromium snapshots are fetched from Google's bucket. |
| Guaranteed device cleanup | confirmed | *triage.* Whatever a run changes on the phone (debug-app setting, command-line file, pulled files) is restored on success, failure, cancel, and next connect after an unplug. One exception: Chrome's command-line flag, once the user has agreed to it, is left on (D-032). |
| Test on the device's real radio | confirmed | *triage.* An unthrottled mode that records the actual cellular / Wi-Fi connection as the "profile". |
| Device picker and wake/unlock handling | confirmed | *triage.* Choose among installed browsers; detect a locked or sleeping screen before a run. |
| Command-line switches without the manual flag | confirmed | *triage.* The test browser is set as the system debug app and switches are read from the command-line file. Verified on Play-installed stable, Beta, Dev and Canary without root (RE-005). Both pieces of device state are saved and restored around every run. On Android 17, targetSdk 37 channels (Beta, Dev, Canary today) also need Chrome's `#enable-command-line-on-non-rooted-devices` flag (RE-020). It is turned on only with the user's consent and then left on, so the phone remembers the answer. A refusal is remembered per device and channel (D-032). |
| Capture-side analysis of screenrecord video | confirmed | D-021. Orange start, crop rectangle and kept-frame times are found in the capture page (demux plus WebCodecs, no ffmpeg) and written to the manifest; the raw MP4 goes into the artifact. S7 ran this in 1–2 s per recording (RE-013). |
| `adb shell screenrecord` as the default Android video source | confirmed | D-014. H.264, whole display, no measurable load-time overhead in S1 (RE-006); 180 s limit per recording. Aligned and reduced with wptagent's orange-frame logic. |
| Trace screenshots as an optional Android video source | confirmed | D-014. Content-only frames already on the trace clock (RE-004). Opt-in. S7 measured it: about 11–16% longer loads on a light page against none for screenrecord, 1.6–3.2 MB per load, and capture stops silently when the frame budget runs out — about 1.5 s of animation at full size (RE-013). The UI should say so where the option is offered. |
| scrcpy stream as a video source | rejected (D-024) | *(brainstorm)* Not needed: `screenrecord` covers Android video, and scrcpy would mean pushing a server binary to the phone. |

## Extension-driven capture in the local browser

| Feature | Status | Notes |
| --- | --- | --- |
| Capture in the user's local browser, driven by an extension, in a dedicated tab | confirmed | Owner's kickoff scope. The extension source lives in this repo. D-005. |
| Accurate network throttling via Chrome's socket-layer emulation | confirmed | Same owner-raised capability as on Android. S1 found it is behind a default-off feature with no `chrome://flags` entry, and an extension cannot pass command-line switches to its own browser. Per D-013: desktop runs use request-level DevTools throttling until the feature is on by default (or the user starts Chrome with the switch), and the result records which engine applied. RE-001. |
| Video capture using Chrome's native screen recording | confirmed | Same owner-raised capability. S1: works on desktop 157 and Canary 160 over the remote-debugging socket (AV1 MP4). Reachability through `chrome.debugger`: Q3. RE-002. |
| Incognito isolation with fallback and user override | confirmed | *triage.* A fresh incognito window per run when the extension is allowed in incognito **and no other incognito window is open** — otherwise it would share that session — else the normal profile. In the normal profile the user is asked whether to delete all cookies or clear the cache only, with a "never ask again" choice; nothing is deleted unasked. D-009, D-027. S3 verified creating, attaching to, and closing an incognito window (RE-011). |
| Managed-profile detection | confirmed | *triage.* Enterprise policy can block debugger attach; detect and explain. |
| Chrome Web Store distribution at first release | confirmed | *triage.* Load-unpacked during development, a store listing for the first public release. Gives a fixed extension ID; every update waits on store review, so the site must tolerate older extension versions. |
| CDP access through `chrome.debugger`, with the extension as a thin bridge | confirmed | D-018. The pipeline runs in the page; the extension relays CDP and manages test tabs. S3 ran a full capture pass this way (RE-011). |
| Bridge restricted to the capture origin, its own tabs, and an allowlist of CDP methods | confirmed | D-018. The security precautions the owner required; the exact allowlist is defined with the pipeline. |
| NetLog-level detail through the trace `netlog` category | rejected (D-019) | *(brainstorm)* Not possible through the extension: `chrome.debugger` sessions are tab-scoped and tab-scoped desktop traces carry no netlog events (RE-010, RE-011). Desktop network detail comes from `Network.*` events; a real NetLog comes from the helper (D-017). Still available on Android. |
| Filmstrip from trace screenshots as a fallback | rejected (D-024) | *(brainstorm)* Native recording works on desktop, and traces through the extension held no screenshots (RE-011). Trace screenshots remain an opt-in source on Android only. |

## Local helper runner (npx)

| Feature | Status | Notes |
| --- | --- | --- |
| A helper started with `npx` that runs desktop tests the extension cannot | confirmed | D-017, in the first release. Launches a dedicated Chrome with a clean profile and its own switches, reachable from the capture page over loopback. Opt-in; needs Node. |
| Socket-layer throttling on desktop through the helper | confirmed | D-017. The helper can pass the enabling switch; the extension cannot (RE-001, D-013). |
| Real NetLog and browser-level tracing on desktop through the helper | confirmed | D-017. Not reachable through `chrome.debugger` (RE-010, RE-011). |
| Fresh-profile cold start, no debugging bar | confirmed | D-017. A new profile per run instead of incognito; no viewport change at attach. |
| Pairing between the helper and the capture page | confirmed | D-022. A link whose fragment carries the port and a per-run secret, checked together with the `Host` and `Origin` headers. Prototyped and attacked in S8 (RE-014). |
| Guiding the user through Chrome's loopback permission | confirmed | D-022. A public page cannot reach the helper until the user allows loopback access; until then the connection just hangs (RE-014). The UI explains the prompt and detects pending and denied states. |
| Filtered CDP relay in the helper | confirmed | D-022. The same allowlist as the extension's (D-018). Without it a paired page can read local files through the helper's browser, which S8 demonstrated (RE-014). |
| Android through the helper (adb server) | confirmed | D-023, in the first release. A second route to the Android runner where WebUSB is awkward; the bridge prototype ran a full pass this way (RE-008). Cannot be filtered like CDP — it includes a shell on the phone — so it needs its own opt-in gate, still to be designed. |
| Packet capture and TLS key logging | confirmed | *triage.* Through the helper, after the first release. TLS key logging is an environment variable at browser launch; packet capture needs elevated privileges on most systems. |

## Result artifact

| Feature | Status | Notes |
| --- | --- | --- |
| Single self-contained result `.zip` in a new manifest-based format | confirmed | D-007. Layout and fields: Q5. |
| Environment / provenance block in the manifest | confirmed | Runner, throttling engine, profile isolation actually applied (D-009), browser build — so results captured different ways are not compared blindly. Exact fields: Q5. |
| Written spec with a format version, and a validator | confirmed | *triage.* The spec lives in the waterfall-tools repo (D-011). Where the validator code lives follows the spec. |
| STORE-mode entries for already-compressed payloads | confirmed | *triage.* Gzipped traces and MP4 files are stored uncompressed inside the zip so a reader can fetch single members with HTTP range requests. A requirement for the artifact spec (Q5). It follows that text payloads are gzipped before they go in: a NetLog is stored as `netlog.json.gz`, about a tenth of its size, and the builder refuses an uncompressed trace or NetLog. |
| Orange-frame start marker for screenrecord video | confirmed | D-014: wptagent's method — a `#DE640D` cover removed immediately before navigation, so the first non-orange frame is time zero. S7: detection is reliable and the cover also gives the crop rectangle for free; the video clock starts 30–70 ms late, about 200 ms on a cold first load (RE-013). Not needed for trace screenshots. Whether desktop native recording needs the same is untested. |

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
| Provider settings stored locally | confirmed | *triage.* Bucket configuration and tokens are kept only in the browser and sent only to the storage provider. Exactly where secrets are kept still waits on spike S5 (Q6). |

## Viewer integration

| Feature | Status | Notes |
| --- | --- | --- |
| Embedded view: live `waterfall-tools.com` viewer in an iframe, fed by `postMessage` | confirmed | D-006. Needs a waterfall-tools change. |
| Published view: open the shareable URL in waterfall-tools | confirmed | D-006. |
| No renderer in this repo | confirmed | D-006. |
| Locally stored results readable by both sites | rejected (D-020) | Floated by the owner at kickoff. S4 showed a storage bridge is possible (RE-012); the owner chose not to couple the two origins. Results are kept by the capture site and posted to the embedded viewer. |
| Hand-off without re-upload ("open in full viewer") | rejected (D-020) | *(agent)* Depended on the storage bridge. An unpublished result is viewed in the embedded viewer; full-page viewing on the viewer site needs publishing. |

## Cross-repo dependencies (waterfall-tools)

Not features of this repo, but nothing here is viewable without them. They are
work items for the waterfall-tools project and need the owner's scheduling.

| Dependency | Needed by | Notes |
| --- | --- | --- |
| Artifact format spec document | every producer and the parser | D-011: the spec is authored in the waterfall-tools repo. |
| Input parser for the new manifest zip | every viewing path | D-007. Must handle multi-run and first/repeat view results. |
| `postMessage` load API in the viewer, open to any embedder | embedded view | D-006, D-020. Today's API is a same-origin global and throws `SecurityError` across origins (RE-012). No allowlist and no storing on the viewer side; the viewer treats the payload as untrusted and replies only to the sender's origin. |
| Loading a published result by reference (for example a Drive file id) | published view | Shape depends on Q6. Open to anyone with the link, full-page or embedded by any site (D-020). |
| Fetch-proxy format sniff updated for the new zip | published view via proxy | The existing waterfall-tools Worker only proxies formats it recognises. It also refuses a body over 100 MiB and any `Range` request, so a large result, or a range read of one, works only against storage the browser can fetch directly. |
| Filmstrip / video display from a raw recording plus manifest metadata | video capture being worth anything | D-021. The viewer decodes H.264 from the MP4 and applies the manifest's start offset, crop rectangle and frame times. Decoding verified in Chrome only (RE-013). Who computes visual metrics is still open. |
| Scoping a whole-session NetLog to the tested page | real NetLog on Android | A NetLog covers the browser session; most entries from a simple load were the browser's own background requests (RE-009). Could instead be done on the capture side. |
| Tolerating an unterminated NetLog | real NetLog on Android | Already works in waterfall-tools 0.4.0 (RE-009); listed so it is not regressed. D-016 relies on it unless the capture side repairs the file (Q5). ndjson input is not needed. |

## Out of scope for now

Deferred by D-005; listed so nobody rebuilds them here by accident: agent
rendezvous and pooled agents, work queues, hosted fallback test machines, the
shared-link edge proxy, BYO CI runners and a Docker agent, Firefox, Safari,
and iOS. (A local helper run with `npx` was on this list and is now in
scope — D-017.) If a rendezvous service is ever built, sign-in for it is
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
   *Mostly answered 2026-11-23* (matrix in plan.md, details in RE-001..005):
   CDP, tracing with netlog, and request-level throttling work on Android
   stable through Canary; socket-layer throttling works on 160.0.8167+ with a
   command-line switch, which Android can supply and the desktop extension
   cannot (D-013); native recording works on desktop and **not on Android**.
   The WebUSB transport then ran a full capture pass end to end (RE-007),
   and the Android video path is decided (D-014). **Answered**, for one
   phone and a Windows host; other hosts and phones are untested.
2. **Can a real NetLog be captured on unrooted Android?** How command-line
   switches get applied (flag versus debug-app), a path Chrome can write and
   the adb shell can read, and getting a complete file rather than a truncated
   one. If this fails, Android falls back to trace-level netlog like desktop.
   *Spike S2.* Applying switches is answered (debug-app plus the
   command-line file, RE-005). The NetLog itself works on the test phone via
   `/sdcard/Download` (RE-009); the app-specific external folder the
   brainstorm suggested does not, because adb cannot read the file. The
   stop method is decided: plain JSON ended by force-stop (D-016).
   Confirmed with SELinux enforcing on Android 17 (RE-020). That run found
   that targetSdk 37 channels ignore the command-line file unless a Chrome
   flag is on.
3. **Where does capture logic live for the extension runner?** Either the page
   owns one CDP capture pipeline shared by both runners and the extension is a
   thin bridge, or the extension runs the capture itself. Hinges on MV3
   service-worker lifetime during a multi-run test lasting many minutes,
   moving tens of MB of trace and video between extension and page, and
   whether screen recording and incognito control work through
   `chrome.debugger`. *Spike S3.* *Answered 2026-11-23 as a recommendation:*
   the page owns the pipeline and the extension is a thin, stateless bridge
   (RE-011). All three concerns measured fine. The real cost is elsewhere:
   the extension can never get netlog events into its trace, and attaching
   changes the viewport height. **Decided: thin bridge with security
   precautions (D-018).** Measured (RE-015): page timers stall while
   the capture page is hidden — to once a minute after five minutes — but
   bridge messages and worker timers do not, so the pipeline must not wait on
   page timers.
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
   permission. *Spike S4.* **Answered 2026-11-23 (RE-012):** confirmed on
   Chrome 157 and 160 with a same-site, cross-origin stand-in — the framed
   viewer sees the viewer's first-party storage, a 50 MB transfer and store
   takes about 65 ms, and a later full-page visit reads the result. No
   framing permission is needed today. Not yet tried on the real domains.
   **Decided (D-020):** for unpublished results, postMessage only, open to
   any embedder (published results load by reference, equally open); the storage
   bridge is not used and results are kept by the capture site.
5. **What exactly is artifact v0?** Layout, manifest and environment fields,
   versioning, and per-run structure for multi-run and first/repeat view
   results. Also: whether a force-stopped NetLog is stored as pulled or with
   its closing brackets appended (D-016). Must be settled jointly with the waterfall-tools parser. *Design
   task, not a spike.* (Where the spec lives is answered: D-011.)
6. **Which storage targets can back a link someone else can open, with no
   backend of ours?** Per target: can a static page complete auth, can the
   uploaded file be made public, and can another origin's browser fetch it
   (CORS, redirects, interstitials, quotas)? The brainstorm's expectation is
   that buckets work directly and Drive and Dropbox need an edge proxy that is
   out of scope (D-005). Also: where user credentials are kept. *Spike S5.*
   *Drive answered 2026-11-24 (RE-021):* **no proxy needed.**
   - **Upload:** a static page signs in through Google's token popup
     (`drive.file`), uploads with a resumable upload, and makes the file
     public.
   - **Opening a link:** another browser opens it through the Drive API with
     a public API key restricted to our origins. That route has CORS and
     `Range`, and served 120 MB with no interstitial. Decided instead
     (D-034): links open through the waterfall-tools `/fetch` proxy, which
     fetches the keyless download URL server-side and will cache it. Local
     testing gets the same proxy.
   - **Credentials:** the token stays in page memory for about an hour, with
     no refresh token.
   - **S3-compatible buckets and Dropbox** are tested when M7 builds them;
     S5 closed on Drive (owner's call).
7. *Answered 2026-11-23 — cold-state policy: user-selectable with an Auto
   default.* See D-009. What each wipe level can technically achieve is still
   covered by S1 and S3.
8. *Answered 2026-11-23 — sign-in only for Drive upload; no telemetry.* See
   D-010.
9. **Test model details.** *The end of a single page load is decided: D-028.* Multi-run with median and first/repeat view are
   confirmed, and Android video alignment is settled (orange frame, D-014);
   still open are the median metric, alignment of desktop native recording,
   and the scripting model — whether to adopt WebPageTest's
   script commands, a subset, or something else, and how custom headers and
   blocked hosts map onto CDP. *Added 2026-11-24:* desktop recording
   alignment gets a spike before M5; and before M9, check whether applying
   socket-layer throttling again between first and repeat view discards the
   warm cache, since each throttling profile has its own (RE-001).
10. **Test-browser install from APKs.** Whether official Chrome channel APKs
    may be re-hosted at all (if not, that half becomes a hand-off to the
    store); where Chromium builds come from and who keeps them current; where
    packages are hosted given file sizes and the static-hosting model (D-001);
    and whether install over WebUSB ADB handles modern multi-package Chrome
    installs. *Spike S6.* *Mostly answered 2026-11-24 (RE-019):* official
    Chrome APKs may not be re-hosted, so those channels hand off to Play.
    Chromium comes from Google's snapshot bucket, which keeps it current.
    The page fetches it directly through the CORS-enabled JSON API, so there
    is no hosting. A snapshot is a single APK, so no multi-package install
    arises. ChromePublic 160 installed and was driven over CDP. Still open:
    an install over WebUSB.
11. **Where does screenrecord video get processed, and what goes in the
    artifact?** D-014 fixes the logic (orange-frame start, sparse frame
    extraction, viewport crop) but ffmpeg cannot be used in the page — its
    in-browser build is GPL (D-002). The re-implementation needs an MP4
    demuxer plus WebCodecs. It could run on the capture side, storing
    extracted frames (or both) in the artifact, or in the waterfall-tools
    viewer, storing only the raw recording. This decides the artifact's video
    layout (Q5) and which repo owns visual-metrics code. Unverified: that
    screenrecord's H.264 decodes through WebCodecs. *Spike S7.*
    *Answered in part 2026-11-23 (RE-013):* it decodes, no demux library is
    needed, and processing takes 1–2 s. Recommendation: analyse on the
    capture side and record the results in the manifest, keep the raw MP4
    in the artifact, and let the viewer decode only what it displays.
    **Decided (D-021):** the capture side analyses, the artifact keeps the
    raw recording, the viewer decodes what it shows. Still open: who
    computes visual metrics, and H.264 decoding in the viewer outside Chrome.
12. **How does the capture page talk to the local helper safely?** The
    helper can drive a browser, so any page that can reach it is a threat.
    Needs: the pairing design; how current Chrome treats a public HTTPS page
    opening a loopback WebSocket (permission prompts, mixed-content rules);
    how the helper finds or obtains a Chrome to launch on each OS; and
    whether it exposes an attached phone. *Spike S8.*
    *Answered in part 2026-11-23 (RE-014):* Chrome requires the user to
    grant a loopback permission, after which `ws://127.0.0.1` works from an
    HTTPS page; the pairing design is accepted as D-022.
    Locating Chrome on macOS and Linux: **answered 2026-11-24 (RE-022)**.
    A fixed list of places per OS found stable Chrome on both, and the
    debugging-pipe launch with a throwaway profile ran a browser-level
    trace on each. macOS needs `--use-mock-keychain`. Untested: headed
    windows, Beta/Dev/Canary, and snap or flatpak builds. The phone question is
    answered — the helper does expose one, in the first release (D-023) —
    and its opt-in gate is designed in M3. The helper may load local and
    private-network addresses (D-030).
13. **May the extension's relay run script in the tested page?** *(raised by
    the second review, 2026-11-24.)* *Answered 2026-11-24: yes — it stays on
    the one allowlist for every runner, with the risk recorded (D-031).*
    The question as it stood: `Runtime.evaluate` is on the one
    allowlist all three runners share. Today only the Android orange cover
    uses it (D-014). Scripted tests (M11) will need it on every runner, as
    WebPageTest scripts run arbitrary script in the page. The cost is in
    the extension's normal-profile fallback (D-027): there a compromised
    capture origin could go from seeing cookies in a trace to acting as the
    user on any site they are signed in to. In an incognito window or the
    helper's throwaway profile there is no such data to reach. Choices: keep
    it everywhere and record the risk; or leave it off the extension's
    relay until scripting is built and decide then how script may run in a
    signed-in profile (incognito only, or with the user's consent per test).
