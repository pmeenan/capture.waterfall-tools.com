# Capture helper

The local helper (D-017, D-022): run it, open the link it prints, and the
capture page can run tests in a dedicated Chrome on this computer. It can do
what the extension cannot: a fresh profile, Chrome's own switches (such as
socket-layer throttling), a browser-level trace and a real NetLog.

```
node helper/bin/capture-helper.js [--origin <capture origin>] [--port <n>]
```

`--origin` is for development against a local capture page, for example
`http://localhost:5173`. Whatever it is, it is the only origin the helper
accepts. Not published to npm before its security review.

How it stays safe (architecture §3.7):
- **Loopback only.** It listens on `127.0.0.1` and has no plain-HTTP surface.
- **Pairing.** The printed link carries the port and a 256-bit secret in its
  fragment. The upgrade must carry the helper's own `Host` and the capture
  `Origin`, and the first message must be the secret, within 3 seconds.
- **One connection at a time.**
- **A filtered relay.** It forwards only CDP on the shared allowlist, and
  only for targets the page created.
- **A throwaway profile per browser,** deleted when the browser exits, which
  includes when the page disconnects.

| File | What it does |
| --- | --- |
| `bin/capture-helper.js` | The command |
| `src/cli.js` | Argument parsing |
| `src/server.js` | Loopback server, checks, control protocol |
| `src/relay.js` | The CDP filter |
| `src/chrome.js` | Finding and launching Chrome; clean close and NetLog read-back |
