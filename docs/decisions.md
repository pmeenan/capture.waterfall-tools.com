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
M0 feature triage the same day; D-013 and D-014 followed spike S1, and
D-015 and D-016 followed the transport and NetLog spikes, and D-017 to D-019 the
extension spike; D-020 followed the hand-off spike and D-021 the video-processing spike.
D-022 is the helper security design; D-023 and D-024 closed the triage of
proposed features, and D-025 fixed the toolchain. D-026 came out of the first run of the
licence gate, in M1.

---

## D-026: Licence policy — BlueOak-1.0.0 allowed; a development-only exception for wrangler  (2026-11-23, status: accepted; amends D-002)

**Decision.** Two changes to the dependency policy of D-002:

1. **BlueOak-1.0.0 joins the allowed list**, for any dependency.
2. **wrangler stays a development dependency**, with a recorded exception for
   the packages it pulls in that are outside the list: the `@img/sharp*`
   image libraries (LGPL-3.0-or-later) and `@speed-highlight/core`
   (CC0-1.0). The exception covers deploy tooling only. None of these may
   ever be part of anything the project ships — the site bundle, the
   extension, or the helper package.

Everything else in D-002 stands, including "no GPL-family licence" for
anything that ships.

**Context.** Decided by the project owner when the licence gate of D-025 first
ran, in M1, and failed on 17 packages. ESLint 10 (chosen in D-004) depends on
minimatch 11 and `@isaacs/nonrecursive-glob-match`, both BlueOak-1.0.0, a
permissive licence D-002 did not name; the owner chose to allow the licence
generally over pinning ESLint 9 or excepting just those two packages.
wrangler, Cloudflare's deploy tool, reaches sharp through miniflare; the
owner chose a development-only exception over keeping wrangler out of the
repository, which was the scaffolding agent's recommendation. Licences were
read from each package's own metadata by the gate.

**Consequences.**
- The gate (`scripts/check-licenses.js`) encodes both: BlueOak-1.0.0 in its
  allowed set, and two name patterns in its exception list. It prints every
  package admitted by an exception on each run, so the list stays visible.
- The exception is by package name, not by licence: another LGPL or CC0
  package arriving by a different route still fails the gate.
- Nothing enforces "never shipped" yet beyond the bundler only including what
  is imported. When the helper becomes a published package (M2, M8), its own
  dependency tree must pass the gate with no exceptions at all.
- An agent may not add or widen an exception; that is the owner's call.

**Reopen if.** One of the excepted packages would become part of a shipped
artifact; or wrangler stops being the deploy tool.

## D-025: Toolchain  (2026-11-23, status: accepted)

**Decision.**

- **Build:** Rollup for production builds, driven by a build script, with
  Vite as the development server — the waterfall-tools arrangement.
- **Repository:** npm workspaces — `site/`, `extension/`, `helper/`,
  `shared/`. npm is the package manager.
- **Checks:** ESLint with warnings treated as errors, vitest for tests (both
  already fixed by D-004), and the TypeScript compiler run in check-only mode
  over the JSDoc-typed JavaScript. No `.ts` sources and no emitted output,
  so D-004's "no TypeScript build step" stands.
- **Licence gate:** a script in CI reads every installed package's own
  licence field and fails on anything outside D-002's list.
- **CI** (GitHub Actions, on pull requests): lint, type check, unit tests,
  build, the licence gate, and the unattended desktop integration paths in
  headless Chrome — the extension loaded over a debugging pipe and the helper
  paired from a page. Android is not in CI; it is run by agents against a
  real phone through the dev bridge.
- **Deploy:** a script with a dry-run mode that the owner runs. No deploy
  credentials are stored in GitHub and nothing deploys automatically.

**Context.** Chosen by the project owner from options put to them at the end
of M0. Rollup + Vite and npm match waterfall-tools; the owner-run deploy
script matches the owner's golemine and parallax projects. The deploy choice
also follows from D-018 and D-022: the capture origin is the trust anchor for
the extension and the helper, so who can publish to it is a security
question. Licences of the tools, from npm metadata on 2026-11-23: rollup
4.68.8, vite 8.3.8, eslint 10.15.0 and vitest 5.1.1 are MIT; typescript 7.0.2
is Apache-2.0.

**Chosen by the scaffolding agent as defaults, open to change without a new
entry:** Node 22 or newer as in waterfall-tools, with CI on Node 24 (the
version used throughout M0); the extension packaged as a zip by a script.

**Consequences.**
- Three deliverables are built from one repository and versioned
  independently: static files, a Web Store zip, an npm package.
- The desktop integration jobs need a Chrome that accepts
  `Extensions.loadUnpacked` over a debugging pipe (rough-edges RE-011) and a
  way to grant the loopback permission through CDP (RE-014); both were done
  only on Windows in M0, and CI runners are usually Linux.
- With Android outside CI, a change can pass CI and still break the Android
  runner. The agent-driven phone run and the manual WebUSB checklist are the
  gate for that code, and reviews of it should say whether they were run.
- A deploy is a deliberate act by the owner, so the published site can lag
  the repository — and the extension and helper must tolerate that.

**Reopen if.** The desktop integration jobs prove too flaky or too slow to
keep as a required check; or an Android emulator job becomes worth its cost.

## D-024: No scrcpy video source; no trace-screenshot filmstrip fallback on desktop  (2026-11-23, status: accepted)

**Decision.** Two proposed video features are rejected: a scrcpy stream as an
Android video source, and a filmstrip built from trace screenshots as a
fallback on desktop.

**Context.** Rejected by the project owner when the last proposed rows were
triaged. Both came from the brainstorm. `screenrecord` covers Android video
with no measurable overhead (D-014, rough-edges RE-006, RE-013), and scrcpy
would mean shipping and pushing a server binary to the phone. On desktop,
Chrome's native recording works through both the extension and the helper
(RE-002, RE-011, RE-014), and traces taken through the extension contained no
screenshots at all (RE-011).

**Consequences.** Trace screenshots remain what D-014 made them: an opt-in
video source on Android only. Desktop video depends entirely on native
recording.

**Reopen if.** Native recording regresses or is removed on desktop, or
`screenrecord` proves inadequate on phones other than the test device.

## D-023: The helper also reaches an attached Android phone, in the first release  (2026-11-23, status: accepted; amends D-022)

**Decision.** In the first release the local helper can also connect the
capture page to an attached Android phone through the desktop adb server, as
a second way to run the Android runner alongside WebUSB.

**Context.** Chosen by the project owner when the last proposed rows were
triaged, over shipping it after the first release (the scaffolding agent's
recommendation) or not at all. It helps wherever WebUSB is awkward: a host
where a running adb server holds the phone, or a browser without WebUSB. The
bridge prototype already ran a full Android capture pass this way (RE-008).
D-022 had listed this as deliberately not included; this entry changes that
one point and leaves the rest of D-022 standing.

**Consequences.**
- **It cannot be filtered the way CDP is.** An adb connection includes a
  shell on the phone; there is no meaningful allowlist of shell commands for
  a runner that has to write files, change settings, and start a browser.
  A paired page therefore gets the same reach over the phone that the WebUSB
  runner already gives the capture origin — but arriving through the helper
  instead of through Chrome's device chooser and the phone's own prompt.
- So this path needs its own gate on top of pairing. Proposed, not yet
  decided: off unless the user starts the helper asking for it, limited to
  one device the user names, and stated plainly in the terminal.
- The security review that D-017 requires before a public build now has to
  cover the adb path as well as the launched browser.
- The Android runner must keep working over either source of an `Adb`
  object, which the architecture already assumes (D-015).

**Reopen if.** The security review cannot find a gate the owner is
comfortable with, in which case the adb path goes back to being
development-only.

## D-022: Security model for the local helper  (2026-11-23, status: accepted; amended by D-023)

**Decision.** The local helper follows the six rules below. This is the
design the D-017 security review asked for, as prototyped and attacked in
spike S8 (rough-edges RE-014). Proposed by the scaffolding agent and accepted
by the project owner as written on 2026-11-23.

1. **Loopback only.** The helper listens on `127.0.0.1` on a port chosen at
   start-up. It offers no plain-HTTP surface: every non-WebSocket request
   gets a 404.
2. **Pairing by link.** On start the helper prints a link to the capture site
   whose URL *fragment* carries the port and a fresh 256-bit secret. The
   fragment is never sent to any server. The secret lives only for that run
   of the helper.
3. **Three checks before anything else.** The `Host` header must be the
   helper's own loopback address (defeats DNS rebinding); the `Origin` header
   must be exactly the capture origin; and the first message must carry the
   secret, compared in constant time. One paired connection at a time.
4. **A filtered relay, not a debugger.** The helper forwards only an
   allowlist of CDP methods, and only `http(s)` URLs may be loaded. No file
   inputs, downloads, local-file URLs, or system-information calls. The
   allowlist is the same definition the extension uses (D-018).
5. **A disposable browser.** Each run gets a new temporary profile, deleted
   afterwards. The browser is closed when the paired connection ends.
6. **Chrome's own permission is part of the flow.** A public page must be
   granted Chrome's loopback-network permission before it can connect; the
   capture UI has to explain the prompt and detect a pending or denied state.

**Deliberately not included:** exposing an attached phone through the adb
server (a separate yes/no, features.md), remembering a secret between runs,
and any outbound connection from the helper.

**What S8 showed.** All of 3 held against a wrong origin with the right
secret, the right origin with a wrong secret, a rebinding-style `Host`, and
a request with no `Origin`. With the filter of 4 on, six abuse attempts were
refused. With it off, the paired page read a file from the local disk through
the helper's browser — the reason 4 is not optional.

**Known limits.** The capture origin remains the trust anchor, as for the
extension (D-018): whoever can serve script from it, to a user who has a
helper paired, can run tests in that helper. A program already running on the
user's machine can forge `Origin` and `Host`, but still needs the secret —
and already has the user's privileges anyway. The secret is visible in the
terminal and in the browser's address bar and history for that tab.

**Reopen if.** Chrome changes how loopback access is granted in a way that
breaks pairing; or review finds a CDP method on the allowlist that reaches
local files or the system.

## D-021: The capture side analyses screenrecord video; the artifact keeps the raw recording  (2026-11-23, status: accepted)

**Decision.** For Android screenrecord video, the capture side does the
analysis: it finds the orange start, the page's crop rectangle, and which
frames to keep, and writes those results into the artifact's manifest. The
artifact carries the recording as pulled from the device, not re-encoded and
not replaced by extracted images. The viewer decodes only what it displays,
using the manifest's metadata.

**Context.** Chosen by the project owner after spike S7 (rough-edges RE-013)
showed the whole of wptagent's logic (D-014) runs in a browser in 1–2 s with
no ffmpeg and no demux library. The alternative was the viewer doing the
processing. The capture side is the one that knows an orange cover was used
and when the navigation started.

**Consequences.**
- The manifest's video section needs at least: the start offset within the
  recording, the crop rectangle, the kept-frame times, and the method used —
  part of the artifact design (features.md Q5).
- The viewer must be able to decode H.264 from an MP4 to show a filmstrip or
  play the video. That is verified in Chrome only (RE-013); published
  results are opened in any browser, so decoding in Firefox and Safari is an
  untested dependency on the viewer side.
- The stated accuracy travels with the result: the video clock starts
  30–70 ms late, about 200 ms on a cold first load (RE-013). Record the
  method in the manifest so a later, better alignment can be told apart.
- Because the raw recording is kept, analysis can be redone later with
  improved logic without re-running the test.
- A raw screenrecord file shows the whole display, including the status bar.
  Anyone who extracts the MP4 from a published artifact sees it uncropped —
  one more thing the publish warning should cover.
- Who computes visual metrics such as visual progress and Speed Index is not
  settled here. The capture side already decodes every frame, which argues
  for doing it there; it is still an open call.

**Reopen if.** The viewer cannot decode these recordings in the browsers
people use to open published results, in which case extracted frames (in
addition to, or instead of, the raw file) become necessary.

## D-020: Unpublished results reach the viewer by postMessage only; local results are stored by the embedder  (2026-11-23, status: accepted)

**Decision.** A result reaches the embedded viewer one way: the embedding
page posts the payload to it with `postMessage`. The viewer accepts that from
any embedder. There is no shared or bridged storage between the capture site
and the viewer: locally kept results live in the storage of whichever page
embeds the viewer — for this project, the capture origin — and are re-opened
by loading them there and posting them again.

**Context.** Decided by the project owner after spike S4 (rough-edges
RE-012): "We don't need the direct storage access. We can just rely on the
postMessage path for all direct-data embedders and just load the payload from
local storage in the parent, independent of the origin it is hosted in. That
keeps the separation clean." S4 had shown a storage bridge was technically
possible — a same-site frame runs with the viewer's own storage — and the
owner chose not to use it. The owner also questioned an earlier claim by the
scaffolding agent that the load handler must restrict embedders; that claim
was wrong for display, since the viewer already loads arbitrary input by URL
or dropped file and is meant to be embeddable.

**Consequences.**
- The viewer needs one addition for the embedded path: an open
  `postMessage` load. No store-into-viewer variant, no local-reference URL
  scheme, no origin allowlist.
- The viewer must still treat every payload as untrusted, answer the sender's
  origin rather than `*`, and never return the user's data in a reply.
- Nothing about the capture site depends on being same-site with the viewer.
  Any third party embedding the viewer gets exactly the same path.
- "Open this result full-page on the viewer site" is not available without
  publishing; the embedded view is where an unpublished result is seen.
- Local result history is entirely the capture site's concern: its storage,
  its quota, its retention.

**Scope, clarified by the owner the same day.** This entry is about *local*
storage: "that's for local storage. Storing on cloud storage should be open
and available for embedding." A result published to cloud storage is loaded
by the viewer by reference, and that path is open in the same way — to anyone
with the link, whether the viewer is opened full-page or embedded by any
site. So an embedder has two ways to show a result, neither restricted by
origin: post the data directly, or point the viewer at where it is stored.

**Reopen if.** Users need an unpublished result to open full-page on the
viewer site badly enough to justify coupling the two origins' storage.

## D-019: No NetLog-level detail from the extension runner's trace  (2026-11-23, status: accepted)

**Decision.** The extension runner does not attempt to get NetLog-level
detail by enabling the `netlog` trace category. That feature is rejected for
the extension. Desktop network detail through the extension comes from CDP
`Network.*` events and the timeline; a real NetLog on desktop is the local
helper's job (D-017).

**Context.** Rejected by the project owner after spike S3 showed it cannot
work: `chrome.debugger` gives tab-scoped sessions only, a tab-scoped trace on
desktop carries no netlog events, and browser-level access is refused
(rough-edges RE-010, RE-011). The idea came from the brainstorm.

**Consequences.** Results from the extension runner have less network depth
than results from Android or the helper, and the artifact's environment
block has to make that visible. On Android the `netlog` trace category does
work and remains available there.

**Reopen if.** Chrome gives extensions a browser-level tracing route, or adds
a CDP NetLog API reachable from a tab session.

## D-018: The extension is a thin CDP bridge; the page owns the capture pipeline  (2026-11-23, status: accepted)

**Decision.** For the extension runner, the capture pipeline runs in the
capture page. The extension is a thin, stateless bridge that relays Chrome
DevTools Protocol commands and events between the page and
`chrome.debugger`, and manages the tabs and windows a test uses. The bridge
ships with security precautions, not as an open relay.

**Context.** Recommended by spike S3 (rough-edges RE-011), discussed, and
decided by the project owner: "The thin bridge model is preferred with
security precautions in place, particularly since we will be hosting the
capture page from a well-known origin." The alternative considered was the
extension running the whole capture behind a narrow "run this test" API. The
thin bridge won on having one pipeline for all three runners (D-017), on
capture logic changing with a site deploy rather than a Web Store review, and
on a service worker that holds no state and so survives being restarted.

**The precautions.** The owner asked for precautions without fixing the list;
these are the ones proposed in that discussion and are the intended set:

- `externally_connectable` names the production capture origin and nothing
  else. A development build may add `localhost`, and must not be the build
  that is published.
- The extension attaches only to tabs and windows it created for a test,
  never to a tab the user already had open.
- It relays only an allowlist of CDP domains and methods the pipeline needs,
  not arbitrary commands.
- Page and extension exchange versions when they connect, since installed
  extensions lag the site.

**Consequences.**
- The trust anchor is the capture origin: whoever can serve script from it
  can drive a debugger in the user's browser, within the limits above. That
  makes the site's own integrity — deploy access, dependencies, no
  third-party scripts (D-010) — part of the extension's security.
- Even with every precaution, a test run in the user's normal profile returns
  a trace containing that profile's cookies for the tested site. Incognito
  (D-009) or the helper's clean profile (D-017) is what removes that, not the
  bridge design.
- The limits of `chrome.debugger` apply regardless: tab-scoped sessions, so
  no netlog in the trace, and the debugging bar changes the viewport
  (RE-010, RE-011).
- The page must tolerate the port dropping between runs and reconnect; the
  worker keeps nothing that matters outside an attached debugger session.
- **Unmeasured risk:** the capture page is in the background while the tab
  under test is in front, and Chrome throttles timers in hidden pages. S3's
  runs worked, but this was not tested deliberately. If it bites, the remedy
  is to move the few timing-critical waits into the extension, not the
  pipeline. To be measured before the extension runner's design is final.
- Whether the Chrome Web Store accepts a debugger relay bound to one origin
  has not been checked against its current policies.

**Reopen if.** Hidden-page throttling makes page-side orchestration
unreliable in a way that moving a few waits cannot fix; Web Store review
rejects the relay model; or the allowlist turns out to need so much of the
protocol that it constrains nothing.

## D-017: A local helper, runnable with npx, is a third runner in the first release  (2026-11-23, status: accepted)

**Decision.** The first release includes a local helper that a user starts
with `npx` when they need more than the extension can give. It launches a
dedicated desktop Chrome with its own clean profile and command line and
makes it reachable from the capture page over a loopback connection, as a
third runner beside the extension and the Android-over-WebUSB runner. The
extension remains the low-friction default; the helper is the high-fidelity
option.

**Context.** Raised by the project owner after spike S3 — "is it worth also
building a npx-runnable helper that people can run for local desktop testing
then when more than the extension is needed?" — and placed in the first
release by the owner. What the extension cannot provide, per S1–S3
(rough-edges RE-001, RE-009..011): socket-layer throttling before Chrome
enables it by default, a real NetLog and netlog events in the trace (no
browser-level session through `chrome.debugger`), a cold start from a fresh
profile rather than incognito, and a viewport undisturbed by the debugging
bar. Most of the machinery is needed anyway for agent-driven testing (D-015).

**This amends earlier entries.** D-005 listed a local companion as deferred —
the helper is now in scope (rendezvous, pooled agents, hosted runners, and
non-Chrome browsers stay deferred). D-015 said the loopback bridge was a
harness that would never be a user-facing runner without a new decision and a
security review — this is that decision, and the review is still owed before
release. D-012's first-release cut now includes the helper.

**Consequences.**
- **Security is the price of admission.** A local process that can drive a
  browser — and possibly a phone — must refuse every page but the capture
  site: loopback binding, a strict origin check, and a pairing secret the
  user carries from the terminal to the page, at minimum. Design and review
  it before any public build (plan.md, spike S8).
- D-001 still holds: nothing is hosted; the helper runs on the user's own
  machine. But the project now ships and supports an npm package, with the
  dependency-policy and supply-chain care that implies (D-002).
- The promise "no install needed" applies to the extension and WebUSB
  runners only; the helper needs Node.
- Three runners produce different-fidelity results, so the artifact's
  environment block must name the runner and what it could and could not
  capture (D-007, D-013).
- The dev harness of D-015 and the helper should be one codebase with one set
  of guards, not a hardened product and a lax test tool side by side.
- Whether the helper also exposes an attached phone through the adb server
  (useful where WebUSB is awkward) is not decided here — it widens what the
  loopback connection can reach.
- Unverified platform risk: how current Chrome treats a public HTTPS page
  opening a loopback WebSocket (a local-network permission prompt may apply).

**Reopen if.** The security review cannot reach a design the owner is
comfortable shipping; or Chrome enables socket-layer throttling by default
and adds what else is missing, removing most of the helper's reason to exist.

## D-016: Android NetLog is plain JSON, ended by force-stop  (2026-11-23, status: accepted)

**Decision.** The Android runner captures a real NetLog with
`--log-net-log` in the default JSON format and ends it by force-stopping the
browser. It does not wait on `--net-log-duration` and does not use the
ndjson format. The resulting file is unterminated — it lacks the closing
`]}` — and that is accepted.

**Context.** Chosen by the project owner after spike S2 (rough-edges RE-009)
compared the options: force-stop leaves an unterminated file whose event
lines are all complete and which waterfall-tools 0.4.0 already converts; the
duration timer gives a clean file but counts from browser launch and has to
be waited out; ndjson is robust to truncation but waterfall-tools does not
read it yet; CDP `Browser.close` is not implemented on Android. The runner
force-stops between runs anyway for isolation (D-009).

**Consequences.**
- No dead time at the end of a run, and no viewer change needed to read the
  log.
- Whatever Chrome had buffered but not written at the moment of the kill is
  lost. S2 saw only complete trailing lines in three runs, which is not a
  measurement of the loss; a short settle delay before stopping is the
  obvious mitigation and its length is untested.
- Whether the capture side appends the missing `]}` so the artifact always
  holds valid JSON, or stores the file as pulled and leaves tolerance to the
  reader, is an artifact-format question (features.md Q5), not settled here.
- The output path is not part of this decision: `/sdcard/Download` works on
  the test phone but is unconfirmed under SELinux enforcing (RE-009).

**Reopen if.** Force-stop is shown to lose meaningful trailing events; a
stock phone cannot produce the file at all; or waterfall-tools gains ndjson
input and the robustness is judged worth switching for.

## D-015: A dev-only adb-server bridge so the Android path can be tested without a human  (2026-11-23, status: accepted; amended by D-017)

**Decision.** Development and automated testing of the Android runner use a
second way of obtaining the ADB connection: the page talks to the desktop
adb server through a small loopback WebSocket bridge, instead of to the phone
over WebUSB. The seam is the library's `Adb` object — everything above it
(shell, file sync, the DevTools socket, the WebSocket/CDP layer, the capture
pipeline, device restore) is the same code in both modes. The bridge is a
development and test harness only. It is never part of the deployed site and
is not a user-facing runner.

**Context.** Proposed by the project owner: "should we have an adb mode that
proxies through the server that uses cli commands and mimics webusb so it can
be tested in automation on localhost and only require manual intervention
when fleshing out the webusb flow?" — then prototyped at the owner's request.
The prototype moved the seam up a layer from the question's wording: WebUSB
carries the ADB daemon protocol, which neither the adb CLI nor the adb server
exposes, so imitating USB would mean re-implementing a daemon. Tango ADB
already ships `AdbServerClient`, which takes a pluggable connector and
returns the same `Adb` type. Result (rough-edges RE-008): the identical
capture pass that needed two human actions over WebUSB ran unattended in
headless Chrome in 19 s.

**Consequences.**
- Agents can build and verify most of the Android runner alone. The part
  that still needs a person is small and specific: the device chooser,
  claiming the interface, the browser's own ADB key and the on-phone prompt,
  detecting a competing adb server, and unplug / reconnect. Keep that as a
  written manual checklist rather than hoping automation covers it.
- The bridge can drive any phone the adb server can see, so it must not be
  reachable by other pages: bind to loopback only, require the dev page's
  exact `Origin`, require a per-run random token, and keep it out of
  production builds entirely. The prototype enforced the first three.
- Throughput and payload sizes differ from USB, so performance numbers still
  come from real WebUSB runs.
- This sits next to the "local companion" runner that D-005 deferred. If it
  is ever wanted as a product feature, that is a new decision with its own
  security review — not a flag flipped on this harness.
- The same idea applies to the desktop runner: a third CDP transport that
  connects straight to a Chrome started with a remote-debugging port would
  let agents exercise the shared capture pipeline without the extension.
  That is proposed, not decided, and not prototyped.

**Reopen if.** The two modes drift so that passing in bridge mode stops
predicting passing over WebUSB; or the harness proves impossible to keep out
of production builds.

## D-014: Android video — screenrecord by default, trace screenshots as an option, wptagent's orange-frame alignment  (2026-11-23, status: accepted)

**Decision.** The Android runner offers two video sources. The default is
`adb shell screenrecord`. Trace screenshots are available as a user-selected
alternative. When recording with screenrecord, the video is aligned and
reduced using the same logic as WebPageTest's wptagent: an orange frame marks
the start, frames are extracted sparsely (near-duplicates dropped), and the
frames are cropped to the page viewport.

**Context.** Decided by the project owner after spike S1 showed Chrome's
native recording fails on Android (RE-002) and measured both alternatives
(RE-004, RE-006): "make both available as options but default to
screenrecord... use the same logic as webpagetest's wptagent with the orange
frame and ffmpeg sparse frame extraction and cropping. I'm a bit nervous
about the overhead of the trace-based capture, particularly on slow devices
(in addition to the frame budget)."

What that logic is, read from wptagent on 2026-11-23
(`internal/android_browser.py`, `internal/adb.py`,
`internal/support/visualmetrics.py`):

- *Capture:* cover the page with a full-viewport div in `#DE640D`, wait
  0.5 s, start `screenrecord --bit-rate 8000000` to a file in
  `/data/local/tmp`, wait 2 s. To begin the test, remove the div and start
  the navigation inside two nested `requestAnimationFrame` callbacks. After
  the test, stop screenrecord, pull the file, delete it from the device.
- *Processing:* find the page viewport within the recorded display by
  scanning one frame for the edges of the system bars; extract frames with
  ffmpeg's `mpdecimate` filter (`=0:64:640:0.001`) so only frames that
  differ are kept, each named by its presentation time; drop everything up to
  and including the orange frames (matched on middle, top, and bottom regions
  with 15% fuzz); the first remaining frame is time zero.

**Consequences.**
- Video time zero is the navigation start, which is how the recording gets
  tied to the trace without any shared clock.
- **ffmpeg itself cannot be used in the page.** The in-browser ffmpeg build
  (`@ffmpeg/core`) is GPL-2.0-or-later per its npm metadata, which D-002
  excludes. "Same logic" therefore means re-implementing the steps above —
  demux, decode with WebCodecs, crop, near-duplicate elimination, orange
  detection — not running ffmpeg. `mp4box` (BSD-3-Clause) and `mediabunny`
  (MPL-2.0) are licence-eligible demuxers. That screenrecord's H.264 output
  decodes through WebCodecs has not been tested.
- Whether this processing runs on the capture side or in the waterfall-tools
  viewer, and so whether the artifact carries the raw recording or extracted
  frames, is open (features.md Q11) and belongs to the artifact design.
- The orange div needs a page to live in before the first navigation of a
  run, and removing it must be the last thing before navigating.
- screenrecord's 180 s limit bounds a single recording (RE-006).
- Trace screenshots stay an opt-in until their cost on a slow phone and the
  behavior when the frame budget runs out have been measured.

**Reopen if.** Chrome's native recording becomes available on Android; or the
WebCodecs re-implementation cannot match wptagent's results closely enough to
be trusted for visual metrics.

## D-013: Throttle with DevTools emulation; socket-layer when available, request-level otherwise  (2026-11-23, status: accepted)

**Decision.** Network throttling always goes through Chrome's DevTools network
emulation (`Network.emulateNetworkConditionsByRule`). The project builds on
the expectation that socket-layer emulation will become the default; until
then, a browser that was not started with the feature switch simply gets
ordinary request-level DevTools throttling. No run is refused, and no other
throttling engine is built, because the switch is missing.

**Context.** Decided by the project owner after spike S1, in their words: "use
dev tools emulation with the expectation that the feature will eventually be
enabled by default and just fall back to regular dev tools throttling without
the command-line as needed". S1 measured both modes with a 600 ms latency rule
on a fresh connection: with `--enable-features=SocketLayerNetworkThrottling`
on Chrome 160, connection setup took about 1240–1360 ms; without it, 30–60 ms
with only the response delayed. Details in rough-edges RE-001.

**Consequences.** The two modes produce materially different waterfalls from
the same settings, and the CDP command and its result are identical in both,
so the tool must determine which engine actually applied and record it in the
result's environment block — never assume from the request. Comparing
measured connection setup time against the configured latency is the
candidate detection method; it is not yet proven robust. Where the tool
controls the browser's command line (Android, via the command-line file) it
supplies `--enable-features=SocketLayerNetworkThrottling` on every run and
does not treat a browser that ignores it as an error — confirmed by the
owner: "apply the switch at all times and just not error out if the browser
doesn't support it. Once it is enabled by default in stable we can remove the
switch." The desktop extension cannot supply it, so desktop results will be
request-level until the default flips, unless the user starts Chrome with the
switch themselves.

**Reopen if.** The feature is removed or stalls instead of shipping by
default; or request-level results prove misleading enough that running
without the switch should be refused or warned against more strongly.

## D-012: The first release is cut after publishing works  (2026-11-23, status: accepted; amended by D-017)

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

## D-005: Repo scope is the capture side; first runners are Chrome-only  (2026-11-23, status: accepted; amended by D-017)

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

## D-002: Apache-2.0, permissive dependencies only  (2026-11-23, status: accepted; amended by D-026)

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
