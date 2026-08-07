# @surea11y/puppeteer

A Puppeteer binding for [`@surea11y/core`](https://github.com/SureA11y/core) — scans a real, already-rendered page for accessibility issues using surea11y's DOM-rules engine.

## Install

```bash
npm install @surea11y/puppeteer puppeteer
```

Puppeteer downloads its own bundled Chrome as part of `npm install` — unlike the Playwright binding, there's no separate browser-install step needed for `npm test` to work.

The cross-browser regression test in `tests/cross-browser.test.js` (proving this works against Firefox too, not just Chrome) additionally needs `npx puppeteer browsers install firefox`.

## Usage

```js
const puppeteer = require('puppeteer');
const { A11yCoreBuilder } = require('@surea11y/puppeteer');

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://example.com/');

const results = await new A11yCoreBuilder({ page })
  .include('#main')            // optional -- call multiple times for multi-region scans
  .exclude('.cookie-banner')    // optional
  .withTags(['wcag2a', 'wcag2aa'])
  .disableRules(['meta-refresh-no-exceptions'])
  .options({ contrast: { mode: 'auditorAssist' } })
  .analyze();

console.log(results.checksResults.filter(r => r.outcome === 'fail'));
await browser.close();
```

`results` is `@surea11y/core`'s own native result shape — see its [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md) — not the `violations`/`passes`/`incomplete`/`inapplicable` shape used by other popular accessibility testing tools. The builder's *method names* are modeled on common conventions in this space for migration familiarity; the richer result schema is kept as-is.

Also see `examples/basic-scan.js` for a runnable script (`npm run example -- <url>`).

`withTags()`/`disableRules()` above have counterparts: `.withRules([...])` (only run these specific rule IDs) and `.disableTags([...])` (never run rules carrying any of these tags). All four compose the same way similar allow/deny-list options do in other accessibility testing tools, with one non-obvious rule worth knowing: a "disable" always wins over a "with" on the same ID/tag (e.g. `.withRules(['a']).disableRules(['a'])` drops `'a'` entirely), and combining `.withRules()` **and** `.withTags()` together requires a rule to satisfy *both* (`@surea11y/core`'s default `includeMode: 'and'` — see [`ENGINE_OPTIONS.md`](https://github.com/SureA11y/core/blob/main/docs/ENGINE_OPTIONS.md)), not either one.

`.exclude(selector)` above excludes globally. Pass a second argument to scope it to specific rule IDs instead: `.exclude('.mat-select', { rules: ['aria-required-children'] })` skips `.mat-select` for that rule only — every other rule still sees it. Global and rule-scoped `.exclude()` calls compose freely.

**Create one builder per scan.** `A11yCoreBuilder` is a mutable object with no reset between `.analyze()` calls — `include()`/`exclude()`/`withRules()`/`disableRules()`/`withTags()`/`disableTags()`/`options()`/`withCustomRules()` all push onto or merge into internal state that persists for the instance's lifetime. Calling one of them again before a second `.analyze()` call *accumulates* on top of the first scan's scope rather than replacing it (this is exactly what makes "call `.include()` several times for one scan," above, work — the same accumulation just also applies across separate scans if you reuse an instance). `.reportOnly()`/`.frames()`/`.elementRef()` are the exception: each call replaces the previous value instead of merging with it.

This binding works against both browsers Puppeteer supports — Chrome (the default) and Firefox via `puppeteer.launch({ browser: 'firefox' })` — verified with a real Firefox run, see `tests/cross-browser.test.js`. There's no WebKit option; that's a Playwright-only engine.

### Using it as an E2E accessibility gate

The pattern above works unchanged inside a real test:

```js
const puppeteer = require('puppeteer');
const { A11yCoreBuilder, formatFailures } = require('@surea11y/puppeteer');

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://example.com/');

const results = await new A11yCoreBuilder({ page }).reportOnly(['fail']).analyze();

assert.strictEqual(results.checksResults.length, 0, formatFailures(results.checksResults));
```

See `examples/e2e-test-example.test.js` for a fuller, runnable version (`npm run example:e2e`) — one test proving real violations get caught (unlabeled button, missing `alt`), one proving a well-formed page passes cleanly. It uses `node:test` directly rather than a dedicated test-runner package: Puppeteer has no first-party test runner the way `@playwright/test` is the default for Playwright, and `node:test` is a zero-new-dependency choice that already matches this project's own test suite.

### Readable console/CI output on failure

A bare length/equality assertion alone gets you a *working* gate, but the failure message is a raw, deeply-nested object diff — hundreds of lines for a handful of violations. `formatFailures(checksResults)` turns that into a short, scannable block (one entry per occurrence, numbered, with rule ID/severity/selector/hint) that you hand to your assertion library's own failure-message parameter, as above. A real failure then prints:

```
Error: 1) button-name-present (serious): This button has no accessible name.
   at html > body > button
   Provide visible button text or a programmatic accessible-name mechanism (for example aria-label) so assistive technologies can identify the button.
2) img-alt-present (serious): Missing alt attribute on <img>.
   at html > body > img
   Add an alt attribute (use alt="" only for decorative images).
```

Deliberately a plain function, not a custom `expect` matcher — no dependency on any particular assertion library, so it works the same with `node:assert`, Jest, Vitest, or a hand-rolled `if`/`throw`. Defaults to `fail`/`cantTell` outcomes (the only two that ever carry occurrences); pass `{ outcomes: [...] }` to narrow further. A thrown rule (`occurrences: []`, `error` set — see [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md)) is still surfaced using its `error` message rather than silently dropped.

### Scanning every frame, including cross-origin iframes

```js
const results = await new A11yCoreBuilder({ page }).frames(true).analyze();

console.log(results.topFrame.checksResults.filter(r => r.outcome === 'fail'));   // the top-level page
for (const frame of results.frames) {
  console.log(frame.checksResults.filter(r => r.outcome === 'fail'));            // each sub-frame, same result shape
}
```

Unlike script-injection-based accessibility tools (which need a `postMessage`-based protocol to reach cross-origin iframes, since they're injected as a plain `<script>` fully subject to the browser's same-origin policy), this needs no extra `@surea11y/core` engine support at all — Puppeteer drives every frame via CDP at the automation-process level, so cross-origin `frame.evaluate()` already just works. Verified against a real cross-origin page (`example.org` embedded in an unrelated origin) — see `tests/builder.test.js`. Default off, so plain `.analyze()` is unaffected unless you opt in.

### Trimming the result to just violations

By default `analyze()` returns every rule's outcome, including `pass`/`notApplicable` — `@surea11y/core`'s own deliberate "not a violations-only list" design (see [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md)). Use `.reportOnly()` to post-filter down to only the outcomes you care about:

```js
const results = await new A11yCoreBuilder({ page })
  .reportOnly(['fail', 'cantTell'])
  .analyze();

console.log(results.checksResults); // only fail/cantTell entries, pass/notApplicable dropped
```

Valid outcome values are `'pass'`, `'fail'`, `'cantTell'`, `'notApplicable'`. This is pure binding-layer filtering — the engine itself still computes every rule; nothing about the scan itself changes. Combines with `.frames(true)`: the filter is applied to `results.topFrame` and each entry of `results.frames` independently.

### Getting a live element handle, not just a selector string

By default each occurrence carries a CSS selector + HTML snippet, not a live reference to the element. Opt in to a real Puppeteer `ElementHandle` with `.elementRef(true)`:

```js
const results = await new A11yCoreBuilder({ page }).elementRef(true).analyze();

const [failing] = results.checksResults.filter(r => r.outcome === 'fail');
await failing.occurrences[0].elementHandle.screenshot({ path: 'flagged.png' });
await failing.occurrences[0].elementHandle.click();
```

This resolves `occurrence.selector` to an `ElementHandle` (via `page.$()`/`frame.$()`) instead of leaving you to re-resolve a possibly-stale selector string yourself. Default off — resolving a handle per occurrence is a real page query per occurrence, so it costs more than a plain `.analyze()`. Combines with `.frames(true)`: each frame's occurrences resolve against that frame's own document. Not every occurrence has one target element — a page-wide finding (some `manual`/`cantTell` rules) can carry `selector: ""`, in which case `occurrence.elementHandle` is `null` rather than a handle.

Each `ElementHandle` holds a browser-side reference until garbage collected or explicitly disposed — for a scan with many violations that you're keeping around a while (rather than using immediately, as above), call `occurrence.elementHandle.dispose()` when you're done with it, per [Puppeteer's own `ElementHandle` guidance](https://pptr.dev/api/puppeteer.elementhandle).

### Registering a custom rule at runtime

`@surea11y/core` supports registering additional rules per-scan via `engineOptions.customRules`. Use `.withCustomRules()` to register one:

```js
const results = await new A11yCoreBuilder({ page })
  .withCustomRules({
    id: 'my-org-custom-rule',
    meta: { title: 'My custom rule', tags: ['custom'], defaultSeverity: 'serious' },
    // A real, live function is fine here -- .withCustomRules() converts it
    // to a function-source string for you (see below for why that matters).
    runInPage(ctx) {
      const el = ctx.document.querySelector('.my-widget');
      return el ? { outcome: 'fail', occurrences: [{ __node: el }] } : { outcome: 'notApplicable', occurrences: [] };
    }
  })
  .analyze();
```

A custom rule descriptor is the same shape as one of `@surea11y/core`'s own internal rule modules (`{ id, meta, runInPage, applicability?, data? }`) — see its [`ENGINE_OPTIONS.md`](https://github.com/SureA11y/core/blob/main/docs/ENGINE_OPTIONS.md) for the full contract. Results appear in `checksResults` exactly like a built-in rule's, including automatic `selector`/`html`/`structuralPath` fill-in. Registered per-scan only (nothing persists between calls or shows up in any catalog listing), and a custom rule whose `id` collides with a built-in one overrides it for that scan.

Pass an array to register several at once, or call `.withCustomRules()` again to add more — like `.withRules()`/`.withTags()`, it accumulates rather than replacing what was already registered:

```js
const results = await new A11yCoreBuilder({ page })
  .withCustomRules([firstRule, secondRule])
  .withCustomRules(thirdRule) // adds a third, doesn't replace the first two
  .analyze();
```

**Why `.withCustomRules()` instead of the raw `.options({ customRules })` passthrough** (still supported, and composes with this method if you use both): `runInPage`/`applicability` must reach the page as a function-source *string*, not a live `Function` — a Puppeteer `page.evaluate()` argument crosses a serialization boundary that can't carry a live function reference, only a string `@surea11y/core` can reconstruct with `new Function` on the page side. Passing a raw live function via `.options()` directly would silently fail to serialize; `.withCustomRules()` calls `.toString()` on a live function for you, so you can write a normal function and not have to remember that constraint yourself. A string is still accepted as-is if you already have one.

Invalid input (a missing/empty `id`, or a `runInPage`/`applicability` that's neither a function nor a non-empty string) throws immediately from `.withCustomRules()` itself, rather than surfacing later as a silently-skipped rule deep inside the page — easier to catch during development. (Note: a *raw* `.options({ customRules })` call bypasses this check entirely and defers to `@surea11y/core`'s own engine-side behavior, which silently skips an invalid descriptor rather than throwing.)

### Element addressing beyond a CSS selector

Every occurrence already carries `selector` and (with `.elementRef(true)`, above) a live `ElementHandle`. It also carries `structuralPath` — a sibling-index path from the document root down to the flagged element (e.g. `[1, 0, 2]`) — a more robust identity than a selector string alone, since it survives some DOM changes a selector wouldn't (an id/class rename, for instance). No opt-in needed; it's already on every `fail`/`cantTell` occurrence today. See [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md) for the full field description.

## TypeScript

`src/A11yCoreBuilder.d.ts` (re-exported from `src/index.d.ts`, wired up via `package.json`'s `types` field) ships hand-written types for the whole builder API plus `@surea11y/core`'s native result shapes (`A11yCoreResult`, `CheckResult`, `Occurrence`, `CompositeResult`, etc.), mirrored from [`OUTPUT_SCHEMA.md`](https://github.com/SureA11y/core/blob/main/docs/OUTPUT_SCHEMA.md). `analyze()` is typed `Promise<A11yCoreResult | A11yCoreMultiFrameResult>` — narrow on `'topFrame' in results` (or cast, if you already know which mode you called) to get the specific shape back, since a fluent builder can't statically track that `.frames(true)` was called earlier in the chain. `puppeteer` is a `peerDependencies` entry (not just `devDependencies`) since the class's `page` argument and `Occurrence#elementHandle` both come from it — consumers need their own `puppeteer` install for the types to resolve, same as they already do to construct a `Page` in the first place.

## Relationship to `@surea11y/playwright`

This binding's builder API is deliberately identical to `@surea11y/playwright`'s — same method names, same mutability contract, same result shapes — so switching between the two (or running the same accessibility gate logic against both) is a drop-in swap of `puppeteer.launch()`/`playwright.chromium.launch()` and nothing else. The one real implementation difference is internal: `analyze()`'s injection call is simpler here, since Puppeteer's `page.evaluate()` is genuinely variadic and doesn't need the wrapper/`eval()` trick Playwright's single-argument `evaluate()` requires.

## Building another framework binding?

See `@surea11y/core`'s [`BINDING_AUTHORS_GUIDE.md`](https://github.com/SureA11y/core/blob/main/docs/BINDING_AUTHORS_GUIDE.md) — a reference for building a new binding, covering which parity features are engine-level (work through a generic `.options()`/`runOnly` passthrough with zero binding code, including WCAG-version tag filtering) vs. binding-layer (element refs, `reportOnly`-style verbosity filtering, the `page.evaluate()`/`frame.evaluate()` serialization-boundary caveat that `.withCustomRules()` exists to paper over). It cites this project's `.elementRef()`, `.reportOnly()`, `.frames(true)`, and `.withCustomRules()` by name as worked examples alongside `@surea11y/playwright`'s.

`A11yCoreBuilder` here extends `A11yCoreBuilderBase` from [`@surea11y/binding-base`](https://github.com/SureA11y/binding-base), a small shared package holding the scaffolding common to every framework binding. A new binding should depend on that package from the start.

## License

MIT — see [`LICENSE`](./LICENSE).

This package depends on [`@surea11y/core`](https://github.com/SureA11y/core), which is MPL-2.0. MPL-2.0's copyleft is file-level and applies only to `@surea11y/core`'s own source files; consuming it as a normal package dependency doesn't affect this package's license.
