# Rough edges — findings log

Chrome, CDP, Android/ADB, WebUSB, extension-platform, storage-provider, and
tooling bugs, quirks, surprising limits, performance cliffs, and missing
capabilities encountered while building the capture tool. Log the ones that
burned real debugging time and will bite again — this is a save-future-you
log, not a compliance artifact.

This project sits on fast-moving, version-dependent browser behavior, so
record the exact Chrome version and channel, the OS, and (for Android) the
device and Android version with every entry. Spike results from M0 belong
here too.

**Before adding:** grep for the API/library involved to avoid duplicates.
**Before debugging weirdness:** check here first — it may be known.

A good entry says what environment it happened in and what was observed vs.
expected; include a reproduction when it's cheap to capture.

Format:

```
## RE-NNN: Title  (YYYY-MM-DD, status: open | fixed-upstream | worked-around | wontfix)
Environment / Repro or measurement / Observed / Expected / Impact / Links
```

Newest first. RE-numbers are never reused.

**About the test phone used for RE-001..009.** The moto g play 2023 is rooted
(Magisk) and runs SELinux in **Permissive** mode, although its build is
`user` / `release-keys` with `ro.debuggable=0`. Every run used the ordinary
adb `shell` user and never `su`, so process identity matches an unrooted
phone — but anything that depends on SELinux policy (which files an app or
the shell may touch) can behave differently on a stock phone. Entries say
so where it matters; the Android results as a whole still need one pass on
a stock, enforcing device.

---

## RE-016: M1 tooling surprises  (2026-11-23, status: worked-around)

**Environment.** Windows 11, Node 24.13.1, npm 11.8.0; eslint 10.15.0,
typescript 7.0.2, vitest 5.1.1, rollup 4.68.8, vite 8.3.8, wrangler 4.167.0.

- **`connect-src 'self'` blocks `fetch()` of a `blob:` URL.** Under the
  site's Content-Security-Policy a page cannot fetch a blob it created
  itself ("Refused to connect"). Reading a `Blob` directly (`.stream()`,
  `.arrayBuffer()`) and offering one through a download link are not
  affected. Code that needs to re-read a result must keep the `Blob`, not
  its URL.
- **A `shell: true` spawn splits the Node path on Windows.**
  `spawnSync(process.execPath, …, { shell: true })` fails when Node lives in
  `C:\Program Files`; npm, a `.cmd` shim, is the only command that needs a
  shell. `scripts/deploy.js` uses one only for that.
- **wrangler brings LGPL binaries and reports usage by default.** Its
  dependency tree includes sharp's prebuilt libraries (D-026), and it sends
  usage data to Cloudflare unless `WRANGLER_SEND_METRICS=false` is set, which
  the deploy script does. Its first-run notice is printed either way.
- **ESLint 10's minimatch is BlueOak-1.0.0**, not ISC as in earlier majors
  (D-026).
- **`waterfall-tools` ships no type declarations**, so importing it under
  `tsc --checkJs` needs a `@ts-expect-error` on the import line.
- **Node's type definitions are not a given.** They were present only as
  another tool's transitive dependency, at a version that tool rejected;
  `@types/node` is now a direct development dependency.

## RE-015: Page timers stall when the capture page is hidden; workers, the extension, and messages do not  (2026-11-23, status: worked-around)

**Environment.** Windows 11, Chrome Canary 160.0.8180.0, headful, the spike
extension bridge of RE-011. The capture page opened a tab under test in
front of itself, attached the debugger, and measured for seven minutes while
the tab under test logged its clock four times a second.

**Measured** (lateness beyond the requested delay, median per minute):

| What the capture page used | Visible | Hidden, minutes 0–4 | Hidden, minute 5 onward |
| --- | --- | --- | --- |
| `setTimeout` chain, 100 ms | 9 ms | about 900 ms (fires once a second) | **48–60 s** (fires once a minute) |
| `setTimeout` chain, 2 s | 7 ms | up to 1 s | 47–58 s |
| Same 100 ms chain in a dedicated worker | 9 ms | 9 ms | 9 ms |
| A 500 ms wait done by the extension's service worker | 13 ms | 12–13 ms | 13 ms |
| Handling a CDP event relayed by the bridge | 2 ms | 2 ms | 2 ms |
| CDP command round trip through the bridge | 2 ms | 2 ms | 2 ms |

- The page really was hidden the whole time (`visibilityState`), and the
  bridge port stayed connected.
- So the transport is unaffected and only page timers are throttled — first
  to once a second, then, after five minutes hidden, to once a minute.
- A window covered by other windows counts as hidden too: a run meant to be
  the visible baseline reported `hidden` until Chrome was started with
  `--disable-features=CalculateNativeWinOcclusion`. The capture page can be
  hidden without the user having switched tabs.

**Consequence.** Orchestration code must never wait on a page timer. Either
react to events, or take time from a dedicated worker, or ask the extension
to wait. The worker is the general answer because it needs nothing from the
runner, and the same rule protects the helper and Android runners whenever
the capture page ends up covered or in a background tab.

**Two gotchas hit while measuring.**
- Re-loading the unpacked extension into a profile that already had it kept
  running the *old* service worker. Use a fresh profile per run when the
  extension has changed.
- Navigating the debugged tab to a `data:` URL through the bridge produced a
  page that never ran its script; the same page served over HTTP worked. Not
  investigated.

**Not tested.** Chrome's energy-saver and memory-saver behaviors, which can
freeze or discard a background tab outright, and runs longer than seven
minutes.

## RE-014: Local helper — loopback access from a public page, pairing, and what an unfiltered relay exposes  (2026-11-23, status: open)

**Environment.** Windows 11. The "user's browser" was Chrome 157.0.8103.79
(stable) and then 160.0.8180.0 (Canary), headful, fresh profile, showing the
real page `https://waterfall-tools.com` with the test script injected. The
helper prototype was about 110 lines of Node using `ws` 8.23.0 (MIT); it
launched Canary 160 on `--remote-debugging-pipe` with a temporary profile.

**Chrome gates loopback behind a permission.**
- On a fresh profile `navigator.permissions.query` reports `prompt` for
  `loopback-network` (and for `local-network` and `local-network-access`).
- Without a grant, `new WebSocket('ws://127.0.0.1:…')` from the HTTPS page
  neither opens nor fails: it stays pending while Chrome shows its prompt
  (still pending after 5 s; the state stays `prompt`). After a denial the
  error is `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, and a `fetch`
  fails with "Permission was denied for this request to access the
  `loopback` address space".
- With `loopback-network` granted — done here through CDP
  `Browser.grantPermissions(['loopbackNetwork'])` to stand in for the user
  clicking Allow — `ws://127.0.0.1` opened in 5–6 ms and `ws://localhost`
  in 15 ms. An insecure `ws://` to loopback from an HTTPS page is not
  treated as mixed content.
- Same behavior in 157 and 160. The wording of the prompt itself was not
  captured.

**Pairing and guards** (each tried from a real page or with a raw request):

| Attempt | Result |
| --- | --- |
| Other site (`https://example.com`), correct secret | refused at connect, HTTP 403 (origin) |
| Right site, wrong secret | accepted, then closed with code 4003 |
| Right `Origin`, `Host: evil.example:<port>` | 403 (host) |
| No `Origin` header | 403 |
| Plain `GET /` | 404 |

**A capture pass through the helper**, from the HTTPS page: browser launched
in 242 ms; connect 938 ms under a 400 ms latency rule (socket-layer
throttling active); a browser-level trace with 18 processes and 5,586 netlog
events; a 607 KB recording; and, after a clean `Browser.close`, a real NetLog
of 1.9 MB that parsed as complete JSON with 7,004 events. The temporary
profile was removed. These are the things the extension cannot produce
(RE-010, RE-011).

**What the relay filter is for.** With the allowlist on, all six abuse
attempts were refused (`file://` navigation and target creation,
`DOM.setFileInputFiles`, `Browser.setDownloadBehavior`,
`Network.loadNetworkResource`, `SystemInfo.getProcessInfo`). With it off,
`Page.navigate` to a `file://` URL followed by `Runtime.evaluate` returned
the contents of a local file to the page, and the download-behavior and
system-information calls succeeded. An unfiltered CDP relay is local file
read for whoever is paired. The same reasoning applies to the extension's
allowlist (D-018).

**Locating Chrome — not solved, only Windows exercised.** The prototype used a
hard-coded path. Known places to look: on Windows the per-machine and
per-user `Google\Chrome*\Application` folders and the `App Paths` registry
key; on macOS the `.app` bundles in `/Applications` and `~/Applications`;
on Linux the `google-chrome*` and `chromium*` commands, with snap and
flatpak builds likely to complicate the debugging pipe and temporary
profiles. `chrome-launcher` 1.2.3 and `@puppeteer/browsers` 3.2.7 (both
Apache-2.0 by npm metadata) are licence-eligible ways to find or fetch a
browser; neither was tried.

**Not tested.** macOS and Linux; an enterprise policy that disables the
loopback permission; how the grant behaves across browser restarts; a user
with several Chrome profiles; and whether a published `npx` package can be
started without a firewall or SmartScreen prompt.

## RE-013: Processing a screenrecord file in the browser; what trace screenshots cost  (2026-11-23, status: open)

**Environment.** Capture: moto g play 2023, Android 13, Chrome Canary
160.0.8180.0, a Wikipedia article loaded 14 times with a 150 ms latency rule,
recorded with `screenrecord --bit-rate 8000000` behind wptagent's orange
cover (D-014). Processing: desktop Chrome 157.0.8103.79, headless, Windows.

**The browser-side pipeline works, without ffmpeg and without a demux
library.**
- *Demux.* screenrecord writes a plain, non-fragmented MP4 with one H.264
  track (`avc1.64001f`, 720x1600, a single keyframe, no B-frame reordering).
  About 60 lines of JavaScript walking the sample tables was enough; demuxing
  took under 1 ms.
- *Decode.* `VideoDecoder.isConfigSupported` was true and every file decoded
  with no error, using the `avcC` box as the description.
- *Speed.* Decoding plus analysing 62–106 full-resolution frames took
  1.1–1.7 s, nearly all of it in unoptimised per-pixel JavaScript.
- *Orange.* The cover decodes as RGB (214, 94, 20) against `#DE640D` =
  (222, 100, 13) — well inside wptagent's 15% tolerance. Because a static
  screen produces no new frames, a recording holds only 2–9 orange frames.
- *Viewport.* The orange cover fills exactly the page viewport, so its extent
  in an orange frame is the crop rectangle: x 0, y 177, 719x1337 in all 14
  recordings, and the cropped frames checked by eye are exactly the page.
  This is simpler and more exact than scanning for system-bar edges.
- *Sparse frames.* Keeping a frame when any 8x8 luma block differs from the
  last kept frame by more than 64 (ffmpeg `mpdecimate`'s `hi`, as wptagent
  sets it) kept 15–29 of 62–97 frames. It is very sensitive: a loading bar or
  a pulsing dot covering 0.5% of the blocks keeps every frame it touches.
- *Dark theme.* With the phone in dark mode the blank page under the cover is
  black, so the first non-orange frame is black, then the content. Logic
  that expects a white start frame would be wrong here.

**How well the video lines up with the page's own clock.** Video time zero is
the first non-orange frame. Comparing the first large change in the video
with the page's First Contentful Paint:

| Start sequence | Video minus page, per run (ms) |
| --- | --- |
| wptagent's: remove the cover, navigate inside two animation frames | -170, -67, -30, -66, -67, -31 |
| Variant: remove the cover, wait 300 ms, then navigate (gap added back) | -209, -54, -57, -119, -59, -66 |
| wptagent's sequence while full-resolution trace screenshots were also on | -218 (one run) |

- The video clock starts late, so video-derived times read early: typically
  30–70 ms, and 170–210 ms on the first load after the browser starts.
- Waiting for the cover's removal to reach the screen before navigating did
  **not** help. The error is the time the removal frame takes to reach the
  display, which the page's paint timing does not carry.
- Not tried: finding the removal frame's presentation time in the trace and
  correcting by it.

**What trace screenshots cost** (the opt-in source of D-014; 4 loads per mode,
interleaved; the "none" mode had no tracing at all, so these numbers include
the cost of tracing itself):

| Mode | FCP median | Load median | Per-load data |
| --- | --- | --- | --- |
| No capture | 808 ms | 1192 ms | — |
| screenrecord | 800 ms | 1207 ms | 0.28–0.5 MB MP4 |
| Trace screenshots, 500 px | 826 ms | 1377 ms | 1.6 MB trace, 43–46 frames |
| Trace screenshots, full size | 846 ms | 1323 ms | 2.6–3.2 MB trace, 21–25 frames |

- screenrecord: no measurable cost. Trace capture: about +20 to +40 ms on FCP
  and +130 to +185 ms on load (11–16%), on a light page. Loads drifted
  upward across rounds in every mode, so treat the differences as indicative.
- **When the frame budget runs out, capture simply stops.** With
  `screenshotMaxCount: 8` on a continuously animating page, the trace held
  the first 8 frames (all within 258 ms) and nothing after, and
  `dataLossOccurred` stayed false. Nothing signals that frames are missing.
  With the default 450 the same page produced 195 frames in 4 s, so a
  full-resolution budget of 72 frames (RE-004) lasts about 1.5 s of
  animation.
- Correction to RE-004: its note that screenshot data crosses the CDP
  connection during the load was not reproduced — over eight loads the bytes
  received during the load were the same with and without screenshots.

**Not tested.** Processing on a phone-class or low-end host, recordings longer
than a few seconds, landscape or rotated recordings, other devices' encoders,
and whether Firefox or Safari can decode these files (relevant only if the
viewer does this work).

## RE-012: Handing a result from the capture origin to the viewer origin  (2026-11-23, status: worked-around)

**Environment.** Chrome 157.0.8103.79 (stable) and 160.0.8180.0 (Canary),
headless, Windows. Three hostnames on one loopback port, standing in for the
real topology: `wt.localhost` (the viewer), `capture.wt.localhost` (same
site, different origin — like `capture.waterfall-tools.com`), and
`other.localhost` (an unrelated site, as a control). Identical results in
both browsers.

**Observed.**
- **A same-site frame gets the viewer's ordinary storage.** The viewer origin
  framed by the capture origin read the `localStorage`, IndexedDB, and OPFS
  values a top-level visit to the viewer had written. Framed by the unrelated
  site, the same page saw none of them — partitioned, as expected.
- **The storage bridge works.** The capture page transferred a 50 MB
  `ArrayBuffer` to the framed viewer; the frame wrote it to OPFS and a record
  to IndexedDB; a later *top-level* visit to the viewer origin found the file,
  52,428,800 bytes, contents verified.
- **The hand-off is cheap.** `postMessage` with a transfer list returned in
  about 0.1 ms and detached the sender's buffer (no copy); message, OPFS
  write, and acknowledgement together took 64–66 ms for 50 MB.
- **The viewer's current API cannot be used across origins.** Reading
  `iframe.contentWindow.WaterfallViewer` throws `SecurityError`.
- The capture origin's own OPFS and `localStorage` are separate from the
  viewer's: being same-site shares nothing by itself.
- A message sent with the wrong target origin was not delivered.
- `Content-Security-Policy: frame-ancestors <capture origin>` on the framed
  page let the capture origin frame it and blocked the unrelated site.

**Production viewer today** (headers read from `https://waterfall-tools.com/`
on 2026-11-23): no `X-Frame-Options`, no `frame-ancestors`, no
cross-origin isolation headers. Any site can already frame it, so no header
change is needed for embedding.

**Correction, same day.** An earlier version of this entry said the load
API must check `event.origin` against an allowlist. That was overstated: for
loading and displaying a result the viewer can accept any embedder, because
it already loads arbitrary input by URL or dropped file. It should treat the
payload as untrusted, reply to the sender's origin, and never return user
data. The storage bridge shown above works but is **not used** — the owner
chose a postMessage-only hand-off for unpublished results, with local
results stored by the embedder; published results load by reference
(D-020).

**Gotchas.**
- `*.localhost` hostnames resolve to loopback inside Chrome and are secure
  contexts, which makes this topology testable without deploying anything;
  `curl` on Windows does not resolve them (send a `Host` header instead).
- `document.hasStorageAccess()` returned `true` even in the partitioned
  cross-site frame, so it is no test of which storage a frame got.

**Not tested.** The real domains over HTTPS with the production service
worker in play; a user who has changed Chrome's third-party storage settings;
storage quota and eviction for large results; and browsers other than Chrome
(irrelevant for capture, relevant if the bridge is ever used elsewhere).

## RE-011: Extension as a CDP bridge — measurements and limits  (2026-11-23, status: open)

**Environment.** Windows 11, Chrome Canary 160.0.8180.0, headful, throw-away
profile, started with `--enable-features=SocketLayerNetworkThrottling`. A
throw-away MV3 extension (permissions `debugger`, `tabs`;
`externally_connectable` for the test page's origin) whose service worker
forwards `chrome.debugger` commands and events over a
`chrome.runtime.connect` port. The capture pipeline ran in the page.

**It works as a thin bridge.** One capture pass from the page, through the
port, in a normal tab and again in a fresh incognito window: throttle rule,
`Tracing.start` with stream read-back, `Page.startScreenRecording` with
`IO.read`, navigation, all succeeded. Connect time under a 400 ms latency
rule was 927 ms and 962 ms, so socket-layer throttling applies through
`chrome.debugger` when the browser has the switch. Recording: 549 KB AV1 MP4
for a 4.9 s load, stop in 18 ms, read in 16 ms.

**Service-worker lifetime.**

| Situation | After the idle period |
| --- | --- |
| Port open, no debugger attached, no messages, 75 s | service worker was terminated; the page's port got `onDisconnect`; a new connection reached a freshly started worker |
| Debugger attached to a tab, no messages, 180 s | worker still the same instance, port still connected, next command worked |

So an attached debugger session keeps the worker alive; an open port alone
does not. Between runs the page must expect the port to drop and reconnect,
and the worker must hold no state that matters outside a debugger session.

**Moving data to the page.** 50 MB pulled in 4 MB chunks (base64 in port
messages): 1.08 s, about 46 MB/s, of which 0.33 s was base64 decoding in the
page. A single 40 MB message worked; a 56 MB one failed with "Message
exceeded maximum allowed size of 64MiB" (the limit applies after base64
growth) without dropping the port. Port messages are JSON, so binary must be
base64 — chunk well under the limit.

**Limits of `chrome.debugger`.**
- Sessions are tab-scoped. `Target.attachToBrowserTarget` and
  `Target.getTargets` return "Not allowed"; `Browser.*` and `SystemInfo.*`
  are "wasn't found". There is no route to a browser-level session, so
  **traces taken through the extension contain no netlog events** (RE-010).
  The brainstorm's plan to get NetLog-level detail on desktop from the trace
  does not work. `Network.*` events do arrive normally.
- The traces from these runs also contained **no screenshots**, although a
  page session over the debugging port does produce them on the same browser
  (RE-010). Not explained.
- Attaching shows Chrome's "started debugging this browser" bar, which took
  56 px off the tab's height (1398 to 1342). The viewport under test changes
  at the moment of attach.
- Incognito: `chrome.windows.create({incognito: true})` and attaching to its
  tab work once the user has allowed the extension in incognito;
  `chrome.extension.isAllowedIncognitoAccess()` reports the setting.

**Automating it (for agents).**
- Branded Chrome ignores `--load-extension` even with
  `--disable-features=DisableLoadExtensionCommandLineSwitch` (160.0.8180.0:
  no extension loaded, no error).
- What works: start Chrome with `--remote-debugging-pipe
  --enable-unsafe-extension-debugging` and call CDP
  `Extensions.loadUnpacked`, which returns the extension id. Incognito access
  can then be switched on from a `chrome://extensions` tab with
  `chrome.developerPrivate.updateExtensionConfiguration`. Closing the pipe
  closes the browser, so the launcher has to stay alive for the run. With
  this the whole extension path ran unattended.

**Not tested.** Stable Chrome, a managed profile, the Web Store build's fixed
id, the worker being killed *during* a run by something other than idleness,
and the page-side cost of very large traces.

## RE-010: What a trace contains depends on which CDP session starts it  (2026-11-23, status: open)

**Environment.** Chrome Canary 160.0.8180.0: desktop (Windows, headful, over
the debugging port) and Android (moto g play 2023, over adb). Same category
list each time: `devtools.timeline`, `loading`, `netlog`,
`disabled-by-default-netlog`, `disabled-by-default-devtools.screenshot`.

| Where `Tracing.start` is sent | Desktop | Android (this phone) |
| --- | --- | --- |
| Browser target | 6 processes, **netlog yes** (1611 events), **screenshots no** | 3 processes, netlog yes (1538), screenshots no |
| Page session | 3 processes, **netlog no**, **screenshots yes** (12) | 3 processes, netlog yes (1523), screenshots yes (15) |

- On desktop a page-session trace is limited to the page's own processes, so
  the network service's netlog events are missing; a browser-target trace has
  them but never screenshots. **No single desktop trace has both**, and only
  one tracing session can run at a time.
- On this phone the page-session trace had both. The likely reason is that
  the network service runs inside the browser process on this low-memory
  device (all traces showed 3 processes); phones that run it out of process
  may behave like desktop. Unverified.
- Screen recording ran alongside either kind of trace on desktop without
  affecting it.
- This refines RE-004: "start tracing on the page session" is what yields
  screenshots, and on desktop it costs the netlog events.

**Impact.** The Android runner can choose per run; the desktop extension
runner cannot have netlog in its trace at all (RE-011). The artifact's
environment block should say which kind of trace it holds.

## RE-009: Real NetLog on Android — what works, and one path that does not  (2026-11-23, status: open)

**Environment.** moto g play 2023, Android 13, Chrome Canary 160.0.8180.0
(Play build), switches applied through the command-line file (RE-005), all
commands as the adb `shell` user. **This phone runs SELinux in Permissive
mode** (see the note at the top of this file), which matters for the path
results below. Source read: `services/network/public/cpp/network_switches.cc`
on main.

**Switches that exist** (from source): `--log-net-log=<path>`,
`--net-log-capture-mode=<Default|IncludeSensitive|Everything>`,
`--net-log-duration=<seconds>` (stop and flush after N seconds),
`--net-log-file-format=<json|ndjson>`, `--net-log-max-size-mb`.

**Output paths.**

| Path | Chrome writes it | adb shell can read it | Verdict |
| --- | --- | --- | --- |
| `/sdcard/Android/data/<pkg>/files/` | yes | **no** — file is created mode 600, `cat` and `adb pull` get "Permission denied" (shell can delete it) | **does not work**, contrary to the brainstorm's suggestion |
| `/sdcard/Download/` | yes, with no storage permission granted | yes | works here |
| `/data/local/tmp/` with the file pre-created mode 666 | yes | yes | works here, but probably only because SELinux is permissive — do not rely on it |

**Stopping and completeness** (all to `/sdcard/Download`, one page load):

| How stopped | Result |
| --- | --- |
| `am force-stop` | 1.4 MB, unterminated JSON: missing the closing `]}`, but every event line complete. waterfall-tools 0.4.0 still converts it (27 entries) |
| `--net-log-duration=8`, wait, browser left running | complete valid JSON, 5194 events, 241 event types, with `polledData` |
| `--net-log-file-format=ndjson` + `am force-stop` | every one of 4973 lines parses on its own; **waterfall-tools 0.4.0 does not recognise the format** |
| CDP `Browser.close` | "Not implemented" on Android; browser keeps running |
| `--net-log-capture-mode=Everything` + duration | 2.3 MB instead of 1.5 MB; waterfall-tools finds response bodies for 18 of 25 entries (none in default mode) |

**Things that will bite.**
- The duration timer starts at browser launch, not at navigation, and logging
  stops for good when it fires. It has to be set longer than launch plus the
  whole test, and the file is only complete after it expires.
- The log covers the whole browser session. A simple page load produced 25–27
  HAR entries, most of them the browser's own background requests, not the
  page's. Something has to scope the log to the test.
- `/sdcard/Download` is visible to the user and to other apps with storage
  access, and a NetLog can hold cookies and credentials — delete the file as
  soon as it is pulled, and use a name that cannot collide.
- One log per browser launch: multi-run and first/repeat view need a relaunch
  (or accept one combined log).

**Not verified.** That Chrome can write to `/sdcard/Download` on a stock
phone with SELinux enforcing, other Android versions (storage rules changed
several times), and how much trailing data `am force-stop` can lose — the
three force-stopped files here all ended on a complete line.

## RE-008: adb-server bridge mode — same capture pass, no human  (2026-11-23, status: worked-around)

**Environment.** Windows 11, desktop Chrome 157 run with `--headless=new`
and a throw-away profile; adb server 1.0.41 on `127.0.0.1:5037`;
`@yume-chan/adb` 2.6.4 (`AdbServerClient`), `ws` 8.23.0 (MIT) for the
bridge; moto g play 2023 with Chrome Canary 160.0.8180.0.

**What was built.** A 34-line Node bridge that accepts a WebSocket on
`127.0.0.1:8766` and pipes it to a TCP connection to the adb server, one TCP
connection per WebSocket. In the page, an `AdbServerClient.ServerConnector`
whose `connect()` opens that WebSocket and exposes it as a byte stream pair;
`client.getDevices()` then `client.createAdb({ serial })`. The capture pass
was the unchanged function used for the WebUSB run (RE-007).

**Observed.**
- Every step passed, start to finish in 19 s with nothing to click: device
  list 13 ms, `createAdb` 33 ms, then the same sequence as RE-007 — state
  save, switches, Canary launch, DevTools socket (4.1 s), HTTP + WebSocket +
  CDP over the socket, orange cover + `screenrecord`, throttled navigation
  (connect 834 ms under a 400 ms latency rule, so socket-layer throttling was
  active), trace read-back, recording pull, 8 MB push (276 ms), restore.
- The run used 43 connections to the adb server: every shell command, socket,
  and sync session is its own connection in the adb host protocol.
- Guards behaved: a wrong `Origin` and a wrong token each got HTTP 403; the
  right pair got 101.
- Unlike WebUSB, the adb server stays in charge of the phone, so `adb`
  commands can run alongside the page — useful for setting up and asserting
  from a test.
- No on-phone prompt, because the desktop adb key is already authorized.

**Gotchas.**
- `transportId` on a device entry is a `bigint`; `JSON.stringify` throws on
  it. Convert before logging or serializing.
- Browser WebSocket has no receive backpressure; messages have to be queued
  into the stream in arrival order (a promise chain was enough here).
- Reverse tunnels are not implemented by this connector.

**Not tested.** An Android emulator as the target, more than one attached
device, very large transfers, and what happens when the adb server restarts
mid-run.

## RE-007: ADB over WebUSB to Chrome's DevTools socket — works end to end  (2026-11-23, status: worked-around)

**Environment.** Host: Windows 11, desktop Chrome 157 (stable), page served
from `http://localhost`. Libraries: `@yume-chan/adb` 2.6.4,
`@yume-chan/adb-daemon-webusb` 2.3.2, `@yume-chan/adb-credential-web` 2.1.0
(all MIT). Phone: moto g play 2023, Android 13, Chrome Canary 160.0.8180.0.
The local adb server was stopped first (`adb kill-server`).

**Observed — one full capture pass, every step succeeded first time.**

| Step | Time |
| --- | --- |
| Device chooser, user picks the phone | 2.8 s (human) |
| Claim the USB interface | 5 ms |
| ADB authenticate, user taps Allow on the phone | 11.8 s (human) |
| `getprop`, shell commands (as uid 2000, no root) | ~0.2 s each |
| Read existing command-line file and debug-app setting | 0.15 s |
| Write command-line file, set debug-app, launch Canary | 0.23 s |
| DevTools socket appears | 4.0 s |
| HTTP `/json/version` over an ADB socket | 12 ms |
| WebSocket upgrade + first CDP command | 9 ms |
| Orange cover, start `screenrecord` as a spawned process | 2.6 s (includes the 2.5 s of deliberate waits) |
| Throttled navigation to load event (400 ms latency rule) | 4.0 s; connect 866 ms, TLS 463 ms — socket-layer active |
| Read a 334 KB gzipped trace back through CDP | 59 ms for 446 KB on the wire |
| Stop screenrecord, pull the 519 KB MP4 over ADB sync | 1.0 s to finalize, 27 ms to pull |
| Push an 8 MB file over ADB sync | 259 ms (about 31 MB/s) |
| Restore command-line file and debug-app | 0.64 s; file verified byte-identical afterwards |

**How the DevTools socket is driven.** `adb.createSocket('localabstract:
chrome_devtools_remote')` gives a raw byte stream. HTTP and the WebSocket
handshake are written by hand on it, and the page implements WebSocket
framing itself (client frames masked, server frames may be fragmented and use
64-bit lengths). Because the page writes the handshake, no `Origin` header is
sent and Chrome's remote-debugging origin check does not come into play. One
socket per HTTP request; one long-lived socket for the CDP session.

**Things that will bite.**
- A running local adb server holds the interface; it must be stopped first.
  Running any `adb` command afterwards restarts the server and takes the
  interface back from the page.
- The browser has its own ADB key (kept in IndexedDB by the credential
  store), so the phone shows the "Allow USB debugging?" prompt the first time
  even if desktop adb was already authorized.
- `screenrecord` ran as a spawned subprocess concurrently with the CDP
  socket and file sync without trouble; stop it with `pkill -INT` and wait
  for exit before pulling.
- The recording from this run: 9.2 s, 213 frames, 519 KB at 8 Mbps nominal.
- The transfer rates above come from small files and are indicative only.

**Not tested.** macOS and Linux hosts, other phone vendors, a phone that had
never had a debug-app set, reconnect after unplugging mid-run, and Chrome on
Android or ChromeOS as the *host*.

## RE-006: `adb shell screenrecord` as an Android video source  (2026-11-23, status: open)

**Environment.** moto g play 2023 (Android 13, 720x1600), screenrecord v1.3,
Chrome Canary 160.0.8180.0, recording a simple page load over adb.

**Measured.**

| Options | File | Duration | Frames | Frame gap (median / max) |
| --- | --- | --- | --- | --- |
| defaults (720x1600, 20 Mbps nominal) | 656 KB | 4.0 s | 54 | 19 ms / 506 ms |
| `--bit-rate 4M` | 659 KB | 4.6 s | 57 | 20 ms / 525 ms |
| `--size 360x800 --bit-rate 2M` | 294 KB | 4.5 s | 55 | 18 ms / 505 ms |

- Output is H.264 (`avc1`) MP4 with one keyframe and a variable frame rate —
  frames are written only when the screen changes. There is also a metadata
  track.
- Page load time with recording running (696–753 ms) was within the spread of
  loads without it (629–714 ms): no measurable overhead on this page.
- Stopping with `pkill -INT screenrecord` and waiting for the file to
  finalize took about 0.9–1.0 s; pulling it took under 0.1 s.
- It records the **whole display** — status bar, browser toolbar, navigation
  bar — so the page area has to be cropped out.
- Nothing ties its timeline to the trace clock: the only timestamp is a
  creation time with one-second resolution. Aligning it needs a visual sync
  marker or matching frames against trace screenshots.
- Hard limit of 180 s per recording (`--time-limit` maximum).

**Impact.** Viable and cheap, but needs cropping and clock alignment that
trace screenshots (RE-004) get for free. Whether the file must live in
`/data/local/tmp` or elsewhere over WebUSB ADB is the same as for adb.

## RE-005: Command-line switches on Play-installed Chrome without root  (2026-11-23, status: worked-around)

**Environment.** moto g play 2023, Android 13, `user` / `release-keys` build
(`ro.debuggable=0`). Play-installed Chrome stable 157, Beta 159, Dev 160,
Canary 160. All commands run as the adb `shell` user; `su` was not used.

**Observed.** Writing `_ <switches>` to `/data/local/tmp/chrome-command-line`
and running `am set-debug-app --persistent <package>` makes that channel pick
up the switches on next launch: `--disable-fre` skipped the first-run
experience on freshly installed channels, and
`--enable-features=SocketLayerNetworkThrottling` changed throttling behavior
on Dev and Canary (RE-001). The one file is shared by every Chrome channel;
the debug-app setting selects which package honors it.

**Also observed.**
- `Browser.getBrowserCommandLine` refuses unless the browser was started with
  `--enable-automation`, so it cannot be used to confirm which switches took
  effect.
- The DevTools socket appeared 4–7 s after `am start` on these builds.
- Both the file and the debug-app setting are global device state that other
  tooling may already be using — this phone had both set for another browser.
  Save and restore them around every run (AGENTS.md rule 11).

**Impact.** Confirms the mechanism the Android runner needs for switches, and
the first half of spike S2. Not yet tested: `--log-net-log` output paths, or
behavior on a phone where the debug-app setting was never set before.

## RE-004: Trace screenshots need tracing started on the page session  (2026-11-23, status: worked-around)

**Environment.** Desktop Chrome 157.0.8103.79 (Windows, `--headless=new`) and
Chromium 150.0.7830.0 on Android 13 (moto g play 2023), both driven over the
remote-debugging WebSocket.

**Observed.** `Tracing.start` on the *browser* target with
`disabled-by-default-devtools.screenshot` in `includedCategories` recorded a
normal trace (timeline, loading, netlog events all present) but zero
`Screenshot` events, on a visible Android tab as well as headless desktop.

**Expected.** Screenshot frames in the trace, as DevTools gets.

**Cause and fix, same day.** Screenshots are only captured when
`Tracing.start` is sent on a session attached to the **page** target. Sent on
the browser target, the same categories record everything except screenshots.
Reproduced both ways back to back on Android Canary 160.0.8180.0: page
session 26 screenshots, browser target 0.

**What the page-session path gives (Android Canary 160, 720x1600 phone).**
- Frames are JPEGs of the web content only — no status bar or browser UI —
  with timestamps on the trace clock, so they need no separate alignment.
- Default size is capped at 500 px on the long side (290x500 here). The
  `screenshotMaxSize` / `screenshotMaxCount` parameters raise it, within a
  budget enforced by the browser: `screenshotMaxSize^2 * 4 *
  screenshotMaxCount` must not exceed **450,000,000**. So 1600 px allows 43
  frames, 800 px allows 175, 500 px allows 450. With `screenshotMaxSize:
  1600` the frames were full resolution (720x1242).
- Frames arrive only when the content changes; gaps as small as 6–8 ms were
  seen, with 13–26 frames for a simple page load.
- Cost: a full-resolution load produced 1.17 MB of JPEG for 13 frames, and
  roughly that much data crossed the CDP connection *during* the load even
  with `transferMode: ReturnAsStream` (0.15 MB without screenshots). Load
  time was not visibly affected on this page, but it is an observer effect
  over a slow link.

**Not tested.** What happens when the frame count budget runs out mid-test,
and the same path on desktop.

## RE-003: Android Chrome CDP differences from desktop  (2026-11-23, status: open)

**Environment.** Chromium 150.0.7830.0 on Android 13 (moto g play 2023,
armeabi-v7a), via `adb forward` to `localabstract:chrome_devtools_remote`.

**Observed.**
- `Target.createBrowserContext` fails with "Failed to create browser
  context." (works on desktop 157). There is no incognito-style isolated
  context over CDP on Android.
- The DevTools socket does not exist until several seconds after
  `am start` on this slow device — a check 4 s after launch found nothing; it
  was there by ~10 s. Poll `/proc/net/unix` rather than sleeping a fixed time.
- `Target.createTarget`, `Network.clearBrowserCache`,
  `Network.clearBrowserCookies`, `Storage.clearDataForOrigin`, and
  `/json/protocol` all work.

**Update, same day.** On Play-installed Chrome 157, 159, and 160 on the same
phone, `Target.createBrowserContext` (create then dispose) **succeeds**. The
failure above is specific to that Chromium 150 dev build or its age. Whether
a tab opened in such a context is usable for a test run on Android was not
tested.

**Impact.** On Android, isolation short of an app-data wipe has the clear
commands (D-009's "CDP-level clear") and, on current Play builds, possibly a
per-run browser context — to be tried before designing around either.
`/json/protocol` is available on-device, so capability preflight can read the
browser's actual command list instead of inferring from the version.

## RE-002: Native screen recording — where it exists  (2026-11-23, status: open)

**Environment.** Desktop Chrome 157.0.8103.79 (Windows, `--headless=new`);
Chromium 150.0.7830.0 on Android 13.

**Observed.**
- Desktop 157: `Page.startScreenRecording` returns an `IO.StreamHandle`;
  `Page.stopScreenRecording` returned in 7 ms; `IO.read` yielded a 40 KB MP4
  (`ftyp isom`, `av01` box — AV1) for a short page load. About 30 KB crossed
  the CDP socket during the recorded load. Both commands are `experimental`.
- Android Chromium 150: `'Page.startScreenRecording' wasn't found`. The
  command is also absent from that build's `/json/protocol`.
- The handler defaults to **800x600** when `maxWidth` / `maxHeight` are
  omitted (read from `content/browser/devtools/protocol/page_handler.cc` on
  main) — always pass the real viewport size.
- Parameters differ by version: 157 has `audio, maxWidth, maxHeight,
  frameRate`; the current published protocol adds `captureArea`
  (`target` | `browserWindow`).

**Update, same day — Android does not support it.** On Play-installed Chrome
for Android stable 157.0.8103.78, Beta 159.0.8154.18, and Canary 160.0.8180.0
the command exists but fails with: `Video recording is not supported without
AV1/libaom enabled.` The Android builds do not ship the AV1 encoder. Desktop
Canary 160 records fine (41 KB AV1 MP4, stop in 2–5 ms).

**Impact.** Video on Android needs another path: `adb shell screenrecord`, a
scrcpy stream, or trace screenshots (RE-004). The Android and desktop runners
therefore cannot share one video pipeline.

**Still untested.** Recording driven through `chrome.debugger` from an
extension (S3), and headful desktop.

## RE-001: Socket-layer throttling is a week old and flag-gated  (2026-11-23, status: open)

**Environment / sources.** Chromium code review and source on main, read
2026-11-23; chromiumdash for first-containing versions.

**Observed.**
- The net-stack primitives landed 2026-11-02 (CL 7703417, first in
  159.0.8140.0). The CDP wiring — "Add socket-layer network delay to CDP's
  emulateNetworkConditionsByRule" — landed 2026-11-16 (CL 7702978, first in
  **160.0.8167.0**).
- It is gated on `BASE_FEATURE(kSocketLayerNetworkThrottling,
  base::FEATURE_DISABLED_BY_DEFAULT)` in
  `services/network/public/cpp/features.cc`. There is **no `chrome://flags`
  entry** (no match in `chrome/browser/about_flags.cc`), so the only switch is
  `--enable-features=SocketLayerNetworkThrottling` on the command line.
- The CDP command is unchanged — `Network.emulateNetworkConditionsByRule` —
  so the protocol description cannot tell you whether a browser will throttle
  at the socket layer or the request layer. On 157 desktop and 150 Android the
  command succeeds and throttles at the request layer.
- Per-URL-pattern socket-layer rules are a separate change still in review
  (CL 8714478); only a global rule can be assumed.
- Per the commit message, each throttling profile gets an isolated session
  with its own socket pools and an **in-memory HTTP cache**. Consequences for
  repeat-view (warm cache) tests are untested.
- On 2026-11-23 the channels were: stable 158 (159 rolling out), beta 159,
  dev 160.0.8171.0, canary 160.0.8180.0. Only dev and canary contain the CDP
  wiring.

**Impact.** Today, socket-layer throttling needs Chrome Dev or Canary 160+
**and** a command-line switch. On Android the command-line file can supply
it (S2). A desktop extension cannot pass command-line switches to the browser
it runs in, so the extension runner gets socket-layer throttling only if the
user launches Chrome with the switch, or once the feature is on by default.
The owner's call on this is D-013: use it where present, fall back to
request-level otherwise.

**Measured, same day.** Rule: 600 ms latency, 200 KB/s down, navigating to a
host not previously contacted. Main-document timings:

| Browser | Switch | connect | TLS | send→headers | Layer |
| --- | --- | --- | --- | --- | --- |
| Desktop Canary 160.0.8180.0 | off | 29 ms | 19 ms | 620 ms | request |
| Desktop Canary 160.0.8180.0 | on | 1358 ms | 636 ms | 949 ms | socket |
| Android Canary 160.0.8180.0 | off | 59 ms | 59 ms | 608 ms | request |
| Android Canary 160.0.8180.0 | on | 1237 ms | 635 ms | 924 ms | socket |
| Android Dev 160.0.8171.0 | on | 1242 ms | 640 ms | 1093 ms | socket |
| Android Beta 159.0.8154.18 | on | 56 ms | 56 ms | 606 ms | request (switch has no effect) |
| Android stable 157.0.8103.78 | off | 52 ms | 52 ms | 602 ms | request |

- With the switch on, the deprecated `Network.emulateNetworkConditions` also
  delayed connection setup, so both commands use the socket layer.
- Connection setup time against the configured latency cleanly separates the
  two modes here, which makes it a candidate way to detect the engine that
  actually applied. Untested on reused connections and on QUIC-first loads.
- An earlier attempt to force fresh connections by toggling emulated offline
  did not close existing sockets; navigating to a new host did.

**Links.** crbug 496616821;
https://chromium-review.googlesource.com/c/chromium/src/+/7702978;
https://chromium-review.googlesource.com/c/chromium/src/+/7703417;
https://chromium-review.googlesource.com/c/chromium/src/+/8714478
