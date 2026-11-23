# Vision

## What this is

webpagetest.org gave the web performance community one thing nothing else
did: run a real browser against a page under controlled conditions, then hand
anyone a link to the waterfall. It also made its operator responsible for
centralized test machines, storage, and scaling.

This project is the capture half of an attempt to give the community that
workflow back without the centralized part. The idea is to decouple three
things around one self-contained result file:

- **Execution** happens on hardware the user already has — a phone plugged
  into their computer, or their own desktop browser.
- **Storage** is wherever the user chooses to put the result.
- **Visualization** is [waterfall-tools](https://waterfall-tools.com), an
  existing client-side viewer by the same author.

`capture.waterfall-tools.com` is the page where a test is configured, run, and
turned into a result; it then hands that result to waterfall-tools to look at
and, if the user wants, publishes it to get a link.

What makes this plausible now is a set of recent Chrome capabilities the
project owner (who works on Chrome's network stack and loading) pointed to:
network emulation moved down into the socket layer, native in-browser video
capture, and a way to pass command-line switches to Chrome on an unrooted
Android device. Whether each of these is reachable from a web page or an
extension, and on which Chrome versions, is the first thing M0 has to
establish — see [features.md](features.md) Q1–Q3.

The broader system sketched in the originating brainstorm — pooled remote
agents, hosted fallback machines, an edge proxy for shared links, non-Chrome
browsers — is deliberately not part of this repository yet (D-005).

## Who it's for

1. **Web performance engineers and browser engineers** who want a controlled,
   repeatable page-load capture and a link they can paste into a bug.
2. **Developers debugging on real mobile hardware**, who have an Android phone
   and a USB cable but no test lab.
3. **Tool builders**, for whom an open result format means their own pipeline
   can produce files the same viewer opens.

## Success criteria

- A user with only a current Chromium desktop browser and an Android phone on
  USB can run a page-load test of Chrome on that phone from the site, with no
  local helper process installed, and see its waterfall.
- A user can do the same against their own desktop Chrome after installing one
  extension.
- A finished result opens in the production waterfall-tools viewer without the
  result leaving the user's machine.
- A user can publish a result to at least one storage target they control and
  get a URL that opens that result in waterfall-tools in someone else's
  browser. (Which targets can do this is open — Q6; the criterion is one, not
  all four.)
- Every result states how it was captured — runner, throttling engine, profile
  isolation, browser build — accurately enough that two results captured
  differently are not mistaken for comparable.
- Running, viewing, and publishing a test requires no server operated by this
  project beyond static file hosting.

## Non-goals

- **A waterfall renderer.** waterfall-tools owns rendering; duplicating it
  here would fork the thing people share links to (D-006).
- **Operating test infrastructure or result storage.** That burden is the
  reason the project exists (D-001, D-008).
- **Non-Chrome browsers and iOS, for now.** The capabilities this design leans
  on are Chrome-specific, and iOS cannot be driven over WebUSB without a
  helper (D-005).
- **Packet-level traffic shaping.** A page or extension cannot run
  `tc`/netem. The claim is Chrome's socket-layer emulation, which the owner
  describes as close to netem but not equal to it; results must say which
  engine was used.
- **Remote / pooled agents and job queues, for now.** Designed in the
  brainstorm, deferred until the two local runners work (D-005).
- **Bulk or CI testing.** The first product is interactive, one test at a
  time.
