# capture.waterfall-tools.com

Browser waterfall capture.

The capture side of a WebPageTest-style testing tool that runs without hosted
test infrastructure. The goal: open a page, run a page-load test on hardware
you already have, and get a result you can view in
[waterfall-tools](https://waterfall-tools.com) and publish to storage you
control.

Planned scope (see [docs/features.md](docs/features.md) for the full ledger,
including what is still being triaged):

- **Three ways to run a test**, all Chrome: on an attached Android device over
  WebUSB; in your local desktop browser driven by an extension; or, when you
  need more than the extension can capture, in a dedicated Chrome launched by
  a small local helper you start with `npx`.
- **One result file.** Every test produces a single self-contained zip in an
  open, manifest-based format that records how it was captured.
- **Your storage, not ours.** Download the result, or upload it to Google
  Drive, an S3-compatible bucket, or Dropbox. The project stores nothing.
- **Viewing by waterfall-tools.** This repo has no renderer; results open in
  the production waterfall-tools viewer.

## Status

**Early.** The first milestone is built: the page shell, the shared building
blocks, and the tooling. Nothing can run a test yet — the first runner is the
next milestone. See [docs/plan.md](docs/plan.md).

## Development

Node 22 or newer.

```
npm ci
npm run dev            # serve the site with Vite at http://127.0.0.1:5173
npm run check          # lint, type check, tests, build, licence gate (what CI runs)
```

Individually: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run licenses`. After a build, `node scripts/preview.js` serves `dist/site`
with the same response headers as production.

Deploying is done by the project owner: `npm run deploy:dry-run` shows what
would be uploaded, `npm run deploy` uploads it, and only from a clean working
tree.

## How this project is built

Almost all code and documentation is written by AI agents working from the
project docs, directed and reviewed by a human who makes every commit.

## Start here

- [AGENTS.md](AGENTS.md) — rules and constraints for contributors (human or AI)
- [docs/vision.md](docs/vision.md) — why this exists and what success means
- [docs/features.md](docs/features.md) — confirmed scope, proposals, open questions
- [docs/plan.md](docs/plan.md) — current milestone and what comes next
- [docs/architecture.md](docs/architecture.md) — system shape (skeleton)
- [docs/decisions.md](docs/decisions.md) — settled choices and their reasons
- [docs/workflow.md](docs/workflow.md) — how agents and the human collaborate
- [docs/rough-edges.md](docs/rough-edges.md) — platform findings log

## License

[Apache-2.0](LICENSE)
