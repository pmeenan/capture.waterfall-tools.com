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

## RE-024: An unread fetch() body never reports loadingFinished  (2026-11-24, status: open)

**Environment.** Chrome stable 157.0.8103.79, headless, Windows 11, launched on the debugging pipe
with a fresh profile. Controlled test page (`tests/helpers/test-pages.js`, `/late-fetch`).

**Observed.** A page called `fetch('/slow?ms=1500')` after its load event and never read the body.
`Network.requestWillBeSent` arrived at once. `responseReceived` and `dataReceived` arrived when the
response came, 1.5 s later. Then nothing: no `loadingFinished` and no `loadingFailed` in the
following 6+ seconds. The response was complete on the wire. With `.then((r) => r.text())` added,
`loadingFinished` came straight after the data.

**Expected.** A finished response reported as finished, whether or not the page reads it.

**Impact.**
- Under D-028 such a request stays "in flight" until it passes the 10 s long-request cutoff. A page
  that fires a request and ignores the reply (beacon-like `fetch` calls) therefore ends about 10 s
  later than it should, not 2 s after the response.
- The run is correct but slow, and the request's end time in the capture is missing.
- Not mitigated yet. Possible fixes:
  - treat a response whose received bytes reach its `Content-Length` as finished;
  - take request ends from the trace's netlog events, which this capture already records.
- The controlled page reads its body so that the test pins down the D-028 rule itself.
- Not tested on other channels or on Android.

## RE-023: Cloudflare injects its Web Analytics beacon into both sites  (2026-11-24, status: fixed)

**Environment.** Both sites run behind Cloudflare: waterfall-tools.com is proxied to nginx on the
owner's server, and capture.waterfall-tools.com is served as Worker static assets. Seen on the
first deploy of the capture site (commit `fe50fa3`).

**Observed.** The HTML both sites serve includes a `<script>` tag for
`https://static.cloudflareinsights.com/beacon.min.js`. Our build does not add it; Cloudflare
inserts it at the edge, from a Web Analytics / automatic-setup setting on the zone.
- **On the capture site** the production CSP (`script-src 'self'`) blocks it, and the console
  logs one CSP error on every load.
- **On waterfall-tools.com there is no CSP**, so the beacon runs. That means Cloudflare Web
  Analytics is collecting page views there today.

**Expected.** No analytics or third-party scripts (D-010). The privacy policy published the same
day says the sites have no analytics.

**Impact.** The fix is a Cloudflare dashboard setting: turn off Web Analytics, or its automatic
injection, for the `waterfall-tools.com` zone. Until then the privacy policy's "no analytics" is
not true on waterfall-tools.com. After the change, check that the HTML no longer contains
`cloudflareinsights`.

**Fixed, same day.** The owner turned off Web Analytics for the zone. Afterwards neither site's
HTML contained `cloudflareinsights`, including a cache-busted request. If it comes back, it is
this setting again.

## RE-022: Locating and launching Chrome for the helper on macOS and Linux (Q12)  (2026-11-24, status: open)

**Environment.**
- **Linux:** Ubuntu 26.04.1 LTS, x86_64, Chrome stable 158.0.8127.36 from Google's `.deb`. No
  snap or flatpak Chrome, and no display. Node 24.18.1 is installed through nvm, so it is on the
  PATH only in a login shell.
- **macOS:** 27.0.1, arm64 (Apple Silicon), Chrome stable 158.0.8127.88 in `/Applications`. No
  Node. The test SSH'd in as one user while another was logged in at the console. Reached over
  SSH from the Linux box. Both machines had only the stable channel.

**Measurement.** A throwaway script did on each machine what the helper will do:
1. Looked for every channel in the usual places (list below).
2. Launched each hit with `--remote-debugging-pipe`, a new `--user-data-dir` in the temp folder,
   and `--headless=new`.
3. Ran `Browser.getVersion`, `Target.createTarget` and `attachToTarget`, a browser-level
   `Tracing.start` with `netlog`, navigated to `example.com`, read `document.title`, then sent
   `Tracing.end` and `Browser.close`.
4. Deleted the profile.

Linux ran it in Node. On the Mac it was a Perl port, because the Mac has no Node.

**Places to look.**
- **macOS:** `/Applications` and `~/Applications`, `<Name>.app/Contents/MacOS/<Name>`, for
  `Google Chrome`, `Google Chrome Beta`, `Google Chrome Dev`, `Google Chrome Canary` and
  `Chromium`.
- **Linux:** `google-chrome-stable`, `google-chrome`, `google-chrome-beta`,
  `google-chrome-unstable`, `google-chrome-canary`, `chromium` and `chromium-browser` on the
  PATH, plus `/opt/google/chrome*/chrome`. `/usr/bin/google-chrome` points through
  `/etc/alternatives` to the `/opt/google/chrome/google-chrome` wrapper script.
- **Deduplicate by real path.**

**Observed.** Every step worked on both machines.

| Host | Executable | First reply | Browser-level trace | Page |
| --- | --- | --- | --- | --- |
| Linux | `/opt/google/chrome/google-chrome` (wrapper script) | 398 ms | ok | ok |
| Linux | `/opt/google/chrome/chrome` (binary) | 256 ms | ok | ok |
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | 627 ms | ok | ok |

- The Linux wrapper script passes the pipe file descriptors through to Chrome.
- No profile folders or Chrome processes were left behind.

**Things that will bite.**
- **macOS: pass `--use-mock-keychain`.** Without it, a fresh profile may ask the login Keychain
  for Chrome's storage key, and that dialog appears on the console user's screen. That is
  standard automation practice; not testing it without the flag was deliberate, because someone
  else was at the console.
- **Fds 3 and 4 must survive `exec`.** Node's `stdio` array does this for you. A hand-rolled
  launcher (Perl here) has to clear close-on-exec on them. The first Mac attempt failed with
  "pipe closed" for that reason, not because of Chrome.
- **Node from nvm** is only on the PATH in an interactive shell. That is fine for `npx` typed by
  a user, but worth knowing for scripted runs.

**Not tested.**
- Headed windows: neither box had a display session for the SSH user.
- Beta, Dev and Canary: not installed on either machine.
- Snap or flatpak Chrome, where sandboxing is expected to complicate pipe launches and temporary
  profiles.
- Intel Macs.

**Impact.** Q12's last open part is answered. The helper can find Chrome by a fixed list of
places on each OS, with no `chrome-launcher` dependency, and the debugging-pipe launch works on
Windows, macOS and Linux.

## RE-021: Google Drive from a static page — what works, and one route that only looks like it does (spike S5)  (2026-11-24, status: open)

**Environment.** The built-in Chromium-based browser pane of the Claude desktop app, on a
Windows 11 host. Spike page served from `http://localhost:8766`, using Google Identity Services'
token client (`google.accounts.oauth2.initTokenClient`), with the `drive.file` scope only. The
owner's OAuth client was published to production. A Drive API key was restricted to the Drive
API and to `localhost` website origins.

**Sign-in.**
- **Testing mode was blocked.** The owner's own account could not be added as a test user
  ("not eligible for designation as a test user"), and sign-in failed with "has not completed
  the Google verification process". The cause is unknown.
- **Publishing to production fixed it, with no Google review for `drive.file` alone.**
  Production needs a home page, privacy policy and terms on an authorized domain. These are
  now on waterfall-tools.com.
- **The token client needs a popup that the user opens.** The pane refused a popup started
  from script.
- **The result is an access token that lives only in page memory.** It reported
  `expires_in: 3599` and there was no refresh token. Getting another token means another
  popup, so the token lasts about an hour.

**Upload and sharing, with the token.**
- **Resumable upload works from a page.** The `Location` header of the session-creating POST
  is readable, so CORS is fine there.
- **Speeds:** 2 MB uploaded in 1.8 s, and 120 MB (125,829,120 bytes) in 30.3 s.
- **Making a file public works.** `POST files/{id}/permissions` with `{role: 'reader', type:
  'anyone'}` returned 200, and the file became "anyone with the link".

**Signed-out fetch, as another person's browser would make it.**

| Route | Result |
| --- | --- |
| `www.googleapis.com/drive/v3/files/{id}?alt=media&key=<API key>`, from an allowed origin | **works**: 200 with CORS, and `Range` passes preflight. 2 MB took 0.4 s and 120 MB took 1.0 s in the pane, with no virus-scan page at 120 MB |
| same URL, from an origin the key does not allow | 403 "Requests from referer … are blocked" (CORS headers present, so the page can read the error) |
| same URL without a key | 403 "missing a valid API key" |
| `drive.google.com/uc?id=…&export=download` (the `webContentLink`) | 403 HTML page |
| `drive.usercontent.google.com/download?id=…&export=download` | **looks like it works from curl** (200, `Access-Control-Allow-Origin: *`), but **fails from a real page**: Chrome reports no `Access-Control-Allow-Origin` header, with or without credentials or redirects |

**Lessons.**
- **Check CORS from a browser, not curl.** The server answers the two differently.
- **The API key is public and has to travel with the viewer.** Its website restriction must
  list every viewer origin, which means `waterfall-tools.com`, plus every capture origin. A
  self-hosted viewer needs its own key.

**Cleanup.** Both test files were deleted with the page's token (Drive's `DELETE` skips the
trash), and a search through the Drive connector confirmed none were left. The spike page and
its copy of the key were deleted.

**Impact.** Uploading needs no proxy: only the page and the user's popup. An expired token
means another popup before uploading. Opening a published link works from a page with a public,
origin-restricted API key. The owner chose instead to route it through the waterfall-tools
`/fetch` proxy, using the keyless URL, so that it can be cached (D-034).

## RE-020: Stock phone, Android 17 — command-line file ignored by targetSdk 37 Chrome  (2026-11-24, status: open)

**Environment.** Pixel 11 (`cubs`), Android 17, build
`CP4A.261205.008.B2`, `user` / `release-keys`, `ro.debuggable=0`, **SELinux
Enforcing**, not rooted. Remote USB through the adb server. Before the run
debug-app had never been set and no command-line file existed. Chrome stable
158.0.8127.92 is a preinstalled system app (`/product/app/Chrome-Stub`,
updated) with targetSdk 36. Beta 159.0.8154.33, Dev 160.0.8171.0 and Canary
160.0.8181.0 are Play installs with targetSdk 37. All commands ran as the adb
`shell` user.

**What works as on the permissive phone (RE-005, RE-009).** On stable, the
debug-app setting plus `/data/local/tmp/chrome-command-line` applied the
switches. `--log-net-log=/sdcard/Download/<file>` was written under
enforcing SELinux (owner `u0_a324:media_rw`, mode 660). `adb pull` read it
as `shell`. After `am force-stop` it was 1.4 MB and 11,372 events, missing
only the closing `]}`, with every line complete: the same shape as RE-009.
The DevTools socket opens on every channel whether or not debug-app is set.

**What does not.** Beta, Dev and Canary, all targetSdk 37, **ignored the
command-line file**. No NetLog was written, and a `--user-agent` switch did
not apply. That held for six Canary launches, by both `about:blank` and VIEW
intents. Each channel also kept going straight into its debugging socket.
The cause is not file access. Canary's renderer runs in plain
`untrusted_app` (stable runs in `untrusted_app_34`), and it displayed the
file's contents at `file:///data/local/tmp/chrome-command-line`. The
platform policy grants `untrusted_app_all` read on `shell_data_file`, and no
AVC denial was logged. **Turning on `chrome://flags`
`#enable-command-line-on-non-rooted-devices` in Canary made it honour the
file.** The UA switch applied and a 775 KB NetLog appeared in
`/sdcard/Download`. So it is Chrome's debug-app check that fails for
targetSdk 37 builds on Android 17. That is inferred, not traced in source.
On Android 13 the same channels honoured the file (RE-005), so the change
probably comes from the Android 17 / targetSdk 37 pair. Stable will hit it
when it moves to targetSdk 37.

**Anomaly.** One NetLog named in the command-line file (last written
11:57:42) appeared from a Canary launch made while the flag was still at
Default. The five Default-flag launches made afterwards to reproduce it did
not apply the file. Unexplained.

**Restored.** The flag is back to Default, the command-line file is
deleted, debug-app is cleared, every NetLog from the run is deleted, all
four channels are force-stopped, and no forwards remain.

**Impact.** On current Android, switches (NetLog, the socket-layer
throttling feature of D-013, `--disable-fre`) reach Beta, Dev and Canary
only if the user, or the runner through CDP on `chrome://flags`, turns on a
flag Chrome labels "DANGEROUS". That is a persistent change to a browser the
user may live in (D-009). Without it, Android Beta/Dev/Canary fall back to
trace-level netlog and request-level throttling. Decided in D-032: the flag
is turned on only with consent, then left on. Untested:
whether a snapshot Chromium (RE-019) behaves the same on Android 17.

## RE-019: Test-browser packages — terms, source, hosting, install (spike S6)  (2026-11-24, status: open)

**Environment.** Windows 11 host, Node 22 and the built-in Chromium-based
browser pane of the Claude desktop app (page served from `127.0.0.1`); moto
g play 2023, Android 13, armeabi-v7a, over the adb server (not WebUSB).
Chromium snapshot r1753238 (V8 16.0.119).

**Terms (read 2026-11-24, not legal advice).** Official Chrome APKs may not
be re-hosted. The Google Terms of Service, which the Chrome Additional Terms
sit under, say "You may not copy, modify, distribute, sell, or lease"
Google's software (policies.google.com/terms), and the Play terms allow
"personal, non-commercial use only" (play.google/play-terms). No Google
statement grants Chrome-for-Android redistribution, and Chrome for Testing
ships no Android build. Chromium snapshots are BSD-3 plus third-party
licences (about:credits), so they are redistributable with notices; they
are built without proprietary codecs (`proprietary_codecs` is false for
unbranded builds), so H.264 / AAC / MP3 in page content may not play —
unchecked on a device. "Chromium" is a trademark: don't present a copy as
official.

**Source.** `chromium-browser-snapshots` on Google Cloud Storage:
`Android/<rev>/chrome-android.zip` (armeabi-v7a; `Android_Arm64/` holds
arm64), `LAST_CHANGE` names the newest revision. The 275 MB zip holds four
deflated APKs: ChromePublic (121 MB → 246 MB), ContentShell (83 → 159 MB),
SystemWebView (66 → 117 MB), SystemWebViewShell (5 MB). ChromePublic is a
single standalone APK — no Trichrome library or splits — so the
multi-package worry of Q10 does not arise for Chromium. Play-installed Chrome
is the multi-package case, and it cannot be hosted anyway.

**CORS — use the JSON API URL.** `storage.googleapis.com/...` and
`commondatastorage.googleapis.com/...` send **no** CORS headers. The JSON API
download URL does, and allows `Range`:
`https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Android%2F<rev>%2Fchrome-android.zip?alt=media`
(answers 206 with `Access-Control-Allow-Origin` echoing the page origin and
`Content-Range` exposed). The listing
`https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o?prefix=Android/<rev>/`
is also CORS-enabled. A page can therefore read the zip's central directory
from the last 64 KB, range-fetch one entry, and inflate it with
`DecompressionStream('deflate-raw')`. Measured in the browser pane:
ChromePublic fetched and inflated in 1.45 s (246 MB; SHA-256 computed in a
further 0.35 s) on a fast connection.

**Hosting.** Cloudflare Workers static assets allow 25 MiB per file
(developers.cloudflare.com/workers/platform/limits, modified 2026-11-19), so
the APKs cannot be served from this site. Fetching straight from Google's
bucket needs no hosting of ours, keeps D-001, and stays current by
`LAST_CHANGE`. Snapshots don't auto-update and are best-effort.

**Install.** `adb install` (streamed install, the same
`cmd package install -S` path a WebUSB client uses) installed
SystemWebViewShell and ContentShell from the extracted APKs first time, with
no prompt on the phone; ContentShell (159 MB) took 12.4 s. ContentShell
started, opened `@content_shell_devtools_remote`, and answered
`/json/version` (Chrome/999.0.0.0). Both were uninstalled afterwards.
Snapshot APKs are signed with the public Chromium debug key (signature
`1ab8683d`), the same key as the phone's existing local Chromium 150 build:
a snapshot ChromePublic would update that in place, and a package signed
with any other key would fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
Downgrading needs a debuggable package, which these are not.

**ChromePublic, same day, with the owner's go-ahead.** `adb install -r`
updated the phone's local Chromium 150 build in place to snapshot
160.0.8182.0 (versionCode 818200000, targetSdk 37) in 14.9 s. The phone has
no way back short of uninstalling. The first launch stopped on
`FirstRunActivity`, and **no DevTools socket opened until first run was
skipped.** With `_ --disable-fre --no-first-run` in the command-line file
(debug-app set to `org.chromium.chrome`), `@chrome_devtools_remote` came up
within seconds. `/json/version` reported Chrome/160.0.8182.0, and a
`--user-agent` switch in the same file took effect, so RE-005's switch
route works for snapshots. `Target.createBrowserContext`, `createTarget` in
that context, a browser-level `Tracing.start` with `netlog`, `Runtime.evaluate`
and `disposeBrowserContext` all succeeded. The isolated-context failure
RE-003 saw on a Chromium 150 dev build does not occur on this snapshot.
Socket-layer throttling on the snapshot is still unchecked. Afterwards the
command-line file was deleted; nobody recorded whether one existed before
the run. debug-app was already `org.chromium.chrome` and remains so.

**Not done.** The install has not been run over WebUSB, which needs the adb
server stopped and a device pick by the user.

**Impact.** The install feature offers Chromium snapshots, fetched by the
page from Google's bucket; official channels are a link to their Play
listings. A freshly installed Chromium must be started with first run
disabled (through the command-line file) or it never opens its DevTools
socket.

## RE-018: Findings from a second outside review of M1  (2026-11-24, status: worked-around)

A second independent agent reviewed the repository. Every finding was checked
against the code before it was acted on; these are the ones worth
remembering.

- **A worker that fails to start says so once, on `error`, and then nothing.**
  The preflight check timed the worker clock out *using the worker clock*, so
  a worker blocked by policy would have left the page on "Checking…" for
  ever. `Clock` now listens for `error` and `messageerror` and rejects
  everything waiting on it, as it does on `dispose()`; the check also has a
  page-timer limit, the one deliberate exception to AGENTS.md rule 6.
- **`Array.prototype.shift` on a long array is not constant time.** The
  WebSocket frame decoder shifted used chunks off its queue one at a time.
  Measured on Node 24.13: a 16 MB frame arriving in 64-byte chunks took
  34.5 s, and 137 ms once the used chunks were removed with one `splice`;
  4 MB took 4.6 s against 45 ms. A trace arrives as frames of this size.
- **One throwing listener starved the rest.** A CDP event was delivered in a
  plain loop, so a listener that threw kept the event from every listener
  after it, including a wait for the load event. Each is now called in its
  own `try`.
- **A command sent on a closing transport leaked.** `send()` registered the
  command before calling the transport; if the transport threw, the entry
  stayed until `close()`. `send()` also takes a timeout and an abort signal
  now. There is still no default timeout: `Page.navigate` on a throttled
  connection can legitimately take a long time.
- **npm marks a lockfile entry `dev` only when nothing outside
  devDependencies reaches it.** The licence gate now applies its recorded
  exceptions only to such entries, so the same package arriving as a runtime
  dependency fails. The old `licenses` array in a `package.json` does not
  say whether its entries are alternatives; it is now read as "all apply".
- **The viewer's fetch proxy has limits a result can hit**: 100 MiB per
  body, and no `Range` requests (`waterfall-tools/cloudflare-worker/worker.js`).
  A NetLog is now gzipped before it goes into the artifact.
- **`npm audit`** found nothing in the 352 packages of the lockfile on this
  date; it is now a CI step.
- **Check that a submodule is really in the commit.** `.gitmodules` reached
  commit `f6107b1` but the submodule's own entry did not, so a fresh clone
  could not have fetched it and the deploy script's clean-tree check failed.
  `git ls-files -s waterfall-tools` prints a line starting `160000` when it
  is there.

## RE-017: Findings from an outside review of M1  (2026-11-24, status: worked-around)

An independent agent reviewed the repository after M1. What it found that is
about platform behavior rather than this project's choices:

- **`Network.clearBrowserCookies` is profile-wide.** Sent through a debugger
  session on one tab, it deletes cookies for every site in the profile. The
  reviewer confirmed this in a disposable Chrome 157 profile: cookies for two
  unrelated sites were gone. Attaching only to test-created tabs does not
  limit it. (The M0 spikes ran this command on freshly installed test
  channels and avoided stable Chrome for exactly this reason, but D-009 did
  not carry the caution through.) Now D-027.
- **A new incognito window joins the existing incognito session** if one is
  open — same cookies, same site data — per Chrome's own documentation
  (https://support.google.com/chrome/answer/95464). Spike S3 only ever ran
  with no other incognito window open. Now D-027.
- **A CDP event wait has to be failed explicitly when the connection goes.**
  Rejecting pending commands is not enough; a wait on
  `Tracing.tracingComplete` stayed pending after close. Fixed in
  `shared/src/cdp-client.js`, which also accepts an abort signal now.
- **ESLint 10 does not support every Node 22.** Its supported range starts at
  22.13; vitest 5 excludes odd-numbered releases. `package.json` now declares
  the intersection.

The reviewer also noted that an automatic approval step refused to delete its
temporary files and disposable Chrome profile; they remain on the machine,
outside the repository.

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
