# Architecture

> **Status: skeleton.** The first full draft is an M0 exit criterion; what is
> written here now is the load-bearing shape already settled, so drafting can
> build on it rather than re-derive it.

## Fixed points (from decisions)

- **Static site, no backend.** Served from Cloudflare at
  `capture.waterfall-tools.com`. Tests execute on the user's hardware. (D-001)
- **Two runners, both Chrome.** An attached Android device over WebUSB, and
  the user's local desktop browser driven by an extension. Remote agents,
  queues, and other browsers are out of scope. (D-005)
- **One output contract.** Every runner produces the same thing: a single
  result zip in the new manifest-based format. (D-007)
- **No renderer here.** The production waterfall-tools viewer displays
  results, either embedded in an iframe and fed by `postMessage`, or by
  opening a published URL. (D-006)
- **User-provided storage.** Local download, Google Drive (`drive.file`), an
  S3-compatible bucket, Dropbox. Nothing is stored by the project. (D-008)
- **The artifact spec is external.** It is authored in the waterfall-tools
  repo; this repo is a producer of it. (D-011)
- **Isolation is a user choice, recorded in the result.** Auto by default:
  full wipe for test-channel browsers, CDP-level clear for stable Chrome;
  incognito with fallback on desktop. The manifest carries the level actually
  applied. (D-009)
- **No accounts except for Drive; no telemetry or third-party scripts.**
  (D-010)
- **Vanilla JS, ESM, current stable Chromium, no polyfills.** (D-004)
- **Two origins, one site.** `capture.waterfall-tools.com` and
  `waterfall-tools.com` cannot script each other or read each other's
  origin-keyed storage; everything between them goes through `postMessage`,
  a URL, or a bridge frame. (D-001, D-006; mechanism open — Q4)

## Expected shape (to be validated in the M0 draft)

Where a bullet below leans on a `proposed` features.md row, it is a design
assumption to confirm during feature triage, not settled scope.

```
                 capture.waterfall-tools.com (static page)
  +-------------------------------------------------------------------+
  |  Test UI  ->  Run controller  ->  Runner (interface)              |
  |                                    |-- Android runner             |
  |                                    |     WebUSB -> ADB -> CDP     |
  |                                    |-- Extension runner           |
  |                                    |     page <-> extension -> CDP|
  |                                    v                              |
  |                              Artifact builder  (manifest + zip)   |
  |                               |                |                  |
  |                               v                v                  |
  |                     Viewer hand-off     Storage providers         |
  +----------------------|---------------------|----------------------+
                         | postMessage         | upload
                         v                     v
            waterfall-tools.com viewer    user's Drive / bucket /
            (iframe, or published URL)    Dropbox / local disk
```

- **Runner interface.** A runner takes a test configuration and yields
  capture payloads plus an environment description. Kept narrow so a later
  remote-agent runner could implement it, without building anything for that
  now.
- **Shared CDP capture pipeline.** Both runners ultimately speak the Chrome
  DevTools Protocol to a Chrome instance; the assumption is that tracing,
  throttling, and recording logic is written once over an abstract CDP
  transport, with the Android runner supplying an ADB-socket transport and
  the extension runner supplying a `chrome.debugger` transport. Whether the
  extension side can be a thin transport or has to host the pipeline is Q3.
- **Run controller.** Owns the test model above a single page load: multiple
  runs, first view / repeat view, median selection, and scripted multi-step
  tests. It sits above the runner interface so both runners get the same
  behavior; a long multi-run test is what stresses Q3.
- **Android runner.** Additionally owns the ADB session: device and browser
  selection, optional installation of a test browser from hosted packages
  (Q10), shell commands for state control and file retrieval, and restoring
  anything it changed on the device.
- **Extension.** An MV3 extension in this repo, distributed through the
  Chrome Web Store at first release. Its message contract with the site is a
  published interface in practice (store review means installed extension
  versions lag the site), so it needs versioning from the first release.
- **Artifact builder.** Assembles the manifest and payloads into the result
  zip in the browser. The format's spec, not this code, is the contract.
- **Storage providers.** One interface, four implementations (D-008).
  "Publish" is upload plus producing a URL the viewer can load; whether a
  given provider can do the second half is Q6.
- **Viewer hand-off.** Holds the embedded waterfall-tools frame and the
  `postMessage` contract; possibly also the storage bridge of Q4.
- **Testability.** Real hardware is not available in CI, so the ADB and CDP
  transports need fakes that replay recorded sessions. This shapes module
  boundaries early.

## Untrusted input

Captured traces, NetLogs, and page content come from arbitrary websites and
must be treated as data, never interpolated into the capture page's DOM
unescaped. `postMessage` handlers on both sides must check the sender's
origin. Results may contain the user's cookies and credentials for the tested
site; nothing leaves the machine without an explicit user action.

## Open architecture questions

The architecture-shaping unknowns are Q1–Q6 in
[features.md](features.md#open-questions-answer-during-m0), each tied to a
spike in [plan.md](plan.md). Purely technical ones not listed there:

- Memory ceiling for assembling a result in the page (trace + NetLog + video
  held at once) and whether payloads should stream to OPFS instead.
- Whether the site needs a service worker at all (offline shell, or
  intercepting hand-off), given that it complicates cache-busting.
- How the site discovers the extension and negotiates versions when the
  extension ID differs between a store build and an unpacked build.
