# a11y-core-puppeteer

A Puppeteer binding for [`a11y-core`](../a11y-core) — scans a real, already-rendered page for accessibility issues using a11y-core's DOM-rules engine.

**Status: not built yet.** This is a fresh project skeleton (package.json, license, this README) with no `src/` implementation. See `ROADMAP.md` for the full plan — what to build, in what order, and every design decision already made so a fresh chat session can start writing code immediately without re-deriving anything.

This is a **separate project/package** from `a11y-core` itself and from its sibling [`a11y-core-playwright`](../a11y-core-playwright), kept as its own sibling directory rather than a monorepo subfolder — see `ROADMAP.md` §1 for the reasoning (same reasoning `a11y-core-playwright` already used).

## Install (once there's something to install)

`a11y-core` isn't published to npm yet, so this package depends on it via a relative `file:` path (see `package.json`):

```json
"dependencies": { "a11y-core": "file:../a11y-core" }
```

That means this project must stay a sibling of `a11y-core` (or you update the path) for `npm install` to resolve it.

```bash
npm install
npm test
```

`puppeteer` (not `puppeteer-core`) is a `devDependency` here, which downloads its own bundled Chrome — unlike the Playwright binding, there's no separate `npx playwright install` step needed for the primary browser.

## Where to start

Read `ROADMAP.md` in full before writing any code. It documents:

- Why this needs its own project instead of copy-pasting `a11y-core-playwright`
- The concrete API differences from Puppeteer vs. Playwright that actually change the implementation (and, just as importantly, the much longer list of things that don't and can port over almost unchanged)
- A method-by-method implementation plan for the builder class, mirroring the already-validated design of `A11yCoreBuilder` in `a11y-core-playwright`
- The full test plan
- What's explicitly out of scope for now (CI, publishing — same call already made for the sibling project)
