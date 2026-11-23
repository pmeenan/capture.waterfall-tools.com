# Plan

**This is a living document.** Milestones will be re-scoped, re-ordered, split,
or added as planning conversations and findings come in. That churn is
expected; what is *not* allowed is silent change. Scope changes get a
decision-log entry; progress is reflected here by checking boxes and updating
status lines as work lands.

Check a box only when the item is done and verified; partially done items stay
unchecked, optionally with a note.

**Status legend:** `pending` · `in progress` · `done` · `parked`

## M0 — Plan the plan  `in progress`

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
      (D-009..D-012). Still to
      do: the rows left `proposed` are each waiting on a spike, and Q1–Q6,
      Q9, Q10 remain open.
- [ ] **Spike S1 — Android capture capability matrix (Q1).** On a real
      unrooted phone over WebUSB: reach Chrome's DevTools socket, record a
      trace with the `netlog` category, apply socket-layer throttling, start
      native screen recording. Output: a table of capability × Chrome channel
      / version (works / fails / needs flag), and the same table for desktop
      Chrome. Throw-away code; findings go to
      [rough-edges.md](rough-edges.md).
- [ ] **Spike S2 — Real NetLog on unrooted Android (Q2).** Output: a working
      command sequence (or a documented dead end) covering how switches are
      applied, the output path, and whether the pulled file is complete.
- [ ] **Spike S3 — Extension bridge (Q3).** Output: a recommendation between
      "page owns the capture pipeline, extension is a bridge" and "extension
      runs capture", backed by measurements: a multi-minute CDP session
      surviving MV3 service-worker lifetime, moving a ~50 MB payload from
      extension to page, screen recording and incognito control through
      `chrome.debugger`.
- [ ] **Spike S4 — Cross-origin hand-off and storage bridge (Q4).** Output:
      confirmation (or refutation) that an embedded `waterfall-tools.com`
      frame under the capture page sees waterfall-tools.com's first-party
      storage, plus a sketch of the `postMessage` contract and the framing
      permission it needs.
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
- [ ] Artifact v0 draft (Q5): layout, manifest and environment fields
      (including the applied isolation level, D-009), version field, per-run
      structure for multi-run and first/repeat view. Authored in the
      waterfall-tools repo (D-011) and agreed with its parser work before any
      runner writes one.
- [ ] Test-model design (Q9): median metric, and the scripting model — how
      much of WebPageTest's script command set to adopt.
- [ ] Schedule the waterfall-tools cross-repo dependencies with the owner
      (features.md, "Cross-repo dependencies") — at minimum the parser and the
      `postMessage` API, since M2 cannot show a result without them.
- [ ] First full draft of [architecture.md](architecture.md).
- [ ] Toolchain decisions: bundler (or none), extension build and packaging,
      test strategy for hardware-dependent code (fake ADB / CDP transports),
      lint config, CI, Cloudflare deploy path, dependency license audit.
      Record in decisions.md. (Vanilla JS / ESM / ESLint / vitest are already
      fixed by D-004.)
- [ ] Rewrite the provisional ladder below into real milestones with exit
      criteria.

**Exit criteria:** the owner has walked features.md and says the plan is good
enough to build from; the architecture-blocking open questions (Q1–Q5) are
answered — the rest may ride along as open questions; toolchain decided; M1+
milestones have scopes. M0 is a conversation, not a phase — it exits on the
owner's call, not on a checklist reaching zero.

## Provisional milestone ladder  `pending — to be rewritten in M0`

Ordered by risk: platform substrate and one working end-to-end path before
breadth. Sketch only — do not start work from these entries, and note that
they freely reference `proposed` features.md rows; nothing here pre-empts the
M0 triage. The spikes above are expected to reorder this, in particular which
runner goes first.

- **M1 — Scaffolding & shell.** Toolchain, lint, tests, CI, license audit,
  Cloudflare deploy of a static shell. Smallest real feature: build an
  artifact v0 zip in the browser from a canned trace and save it with local
  download — which exercises the artifact writer, the riskiest shared piece
  that needs no hardware.
- **M2 — First end-to-end path (extension runner).** Capture a page load in
  the local browser, write an artifact, and show it in the embedded
  waterfall-tools viewer. Trace only; no throttling or video yet. Includes
  capability preflight and run progress / cancel. Blocked on the
  waterfall-tools parser and `postMessage` API.
- **M3 — Android runner end-to-end.** The same path from an attached phone
  over WebUSB (Tango ADB), sharing as much of the capture pipeline as S3 says
  is possible, with the browser picker, adb-conflict guidance, and device
  cleanup.
- **M4 — Capture fidelity.** Socket-layer throttling and connection profiles,
  native video, NetLog (trace-level on desktop, real on Android if S2
  succeeds), the isolation levels of D-009, and a complete environment block.
- **M5 — Publish, then first release.** Storage targets in the order S5
  recommends, shareable URLs, the selectable default result mode, publish
  warning and redaction, resumable uploads. Closes with the release itself:
  Chrome Web Store listing for the extension and public docs.

**— first release cut (D-012) —** Everything below is confirmed scope that
ships after the first release.

- **M6 — Test model.** Multi-run with median, first/repeat view, CPU
  throttling with calibration, desktop device emulation, real-radio mode.
- **M7 — Breadth.** Local history, open-existing-zip, diagnostics log,
  test-browser install from APKs, managed-profile detection.
- **M8 — Scripting.** Scripted multi-step tests, custom headers, blocked
  hosts.

Two things the cut does not defer: the artifact v0 format must already have
room for multiple runs and first/repeat view, because the format is expensive
to change once results are published (D-007); and spike S6 and the Q9
test-model design can wait until after the first release without blocking
M1–M5.
