'use strict';

const { runa11yCoreInPage } = require('@surea11y/core');
const {
  A11yCoreBuilderBase,
  createInPageScan,
  rethrowEngineError,
  queryOccurrenceElement,
  getScanGaps
} = require('@surea11y/binding-base');

// core's scan, wrapped so an engine error keeps its `code` across
// page.evaluate(), which keeps only an error's message. Built once; it is
// self-contained, so Puppeteer serializes it as it did runa11yCoreInPage.
const inPageScan = createInPageScan(runa11yCoreInPage);

/**
 * Puppeteer binding for surea11y -- scans a real, already-rendered page.
 *
 * const results = await new A11yCoreBuilder({ page })
 *   .include('#main')
 *   .exclude('.cookie-banner')
 *   .withTags(['wcag2a', 'wcag2aa'])
 *   .disableRules(['meta-refresh-no-exceptions'])
 *   .options({ contrast: { mode: 'auditorAssist' } })
 *   .analyze();
 *
 * `results` is @surea11y/core's own native result shape (checksResults /
 * rulesResults -- see ../core/docs/OUTPUT_SCHEMA.md), not the
 * violations/passes/incomplete/inapplicable shape used by other tools in
 * this space. Method names are modeled on common conventions in this space
 * for migration ease, but the richer native schema (severity, confidence,
 * occurrences, policy contract, WCAG SC mappings) is kept as-is rather than
 * reshaped to match.
 *
 * Extends `A11yCoreBuilderBase` (from `@surea11y/binding-base`), which owns
 * every method with no driver-specific work at all -- `include()`/
 * `exclude()`/`withTags()`/`disableTags()`/`withRules()`/`disableRules()`/
 * `options()`/`reportOnly()`/`elementRef()`/`frames()`/`withCustomRules()`'s
 * validation (including the default customRules stringification, correct
 * here since Puppeteer's `page.evaluate()` crosses a real serialization
 * boundary), and `_buildEngineArgs()`. This class adds exactly the parts
 * that are genuinely Puppeteer-specific: `analyze()`'s injection mechanics,
 * frame traversal, and `_attachElementRefs()`. See
 * `../binding-base/README.md` for what's shared and why.
 *
 * Opt in to scanning every frame on the page (including cross-origin
 * iframes) via .frames(true):
 *
 * const results = await new A11yCoreBuilder({ page }).frames(true).analyze();
 * // results.topFrame        -- same shape as the single-frame case above
 * // results.frames          -- array of the same native result shape, one per sub-frame
 *
 * Unlike script-injection-based accessibility engines (which need a
 * postMessage-based protocol, runPartial/finishRun, to reach cross-origin
 * iframes, since they're injected as a plain <script> and are fully subject
 * to the browser's same-origin policy), this doesn't need any @surea11y/core
 * engine support: Puppeteer drives every frame
 * via CDP at the automation-process level, not as in-page script, so
 * cross-origin frame.evaluate() already just works -- verified empirically
 * against a real cross-origin iframe, see tests/builder.test.js. Default
 * off, so plain .analyze() keeps returning
 * the single native result object it always has.
 *
 * By default `analyze()` returns every rule's outcome, including
 * `pass`/`notApplicable` -- @surea11y/core's own deliberate "not a
 * violations-only list" design (see ../core/docs/OUTPUT_SCHEMA.md).
 * Opt in to a lighter payload with `.reportOnly(['fail', 'cantTell'])`,
 * which post-filters `checksResults` by `outcome` (applied per-frame when
 * combined with `.frames(true)`, since `checksResults` lives at
 * `results.topFrame` / each `results.frames[i]` in that shape, not at the
 * top level):
 *
 * const results = await new A11yCoreBuilder({ page })
 *   .reportOnly(['fail', 'cantTell'])
 *   .analyze();
 *
 * Opt in to a live `ElementHandle` per occurrence (instead of just a CSS
 * selector string) with `.elementRef(true)`, so you can act on the flagged
 * element directly rather than re-resolving its selector yourself:
 *
 * const results = await new A11yCoreBuilder({ page }).elementRef(true).analyze();
 * const [firstFail] = results.checksResults.filter(r => r.outcome === 'fail');
 * await firstFail.occurrences[0].elementHandle.screenshot({ path: 'flagged.png' });
 *
 * Register your own rule(s) for just this scan with
 * `.withCustomRules([...])` (@surea11y/core's `engineOptions.customRules`
 * escape hatch -- see ../core/docs/ENGINE_OPTIONS.md). Pass a real,
 * live `runInPage`/
 * `applicability` function -- unlike the raw `.options({ customRules })`
 * passthrough, this method converts them to the function-source string
 * @surea11y/core needs on this side of the page.evaluate() JSON boundary for
 * you, so you don't have to remember to call .toString() yourself:
 *
 * const results = await new A11yCoreBuilder({ page })
 *   .withCustomRules({
 *     id: 'my-org-custom-rule',
 *     meta: { title: 'My custom rule', tags: ['custom'] },
 *     runInPage(ctx) {
 *       const el = ctx.document.querySelector('.my-widget');
 *       return el ? { outcome: 'fail', occurrences: [{ __node: el }] } : { outcome: 'notApplicable', occurrences: [] };
 *     }
 *   })
 *   .analyze();
 *
 * Create one builder per scan. This is a mutable object with no reset
 * between analyze() calls: include()/exclude()/withRules()/disableRules()/
 * withTags()/disableTags()/options()/withCustomRules() all push onto or
 * merge into internal state that persists for the instance's lifetime, so
 * calling one of them again before a second analyze() call accumulates on
 * top of the first scan's scope rather than replacing it (intentional for
 * "call include() several times for one scan" -- see above -- but a footgun
 * if you hold one instance across multiple assertions).
 * reportOnly()/frames()/elementRef() are the exception: each call replaces
 * the previous value rather than merging with it.
 */
class A11yCoreBuilder extends A11yCoreBuilderBase {
  /**
   * @param {{ page: import('puppeteer').Page, url?: string }} opts
   *   `page` must already be navigated to and settled at the URL to scan --
   *   this class does not navigate for you.
   */
  constructor({ page, url } = {}) {
    super({ url });
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('A11yCoreBuilder requires { page } (a Puppeteer Page, with an .evaluate() method).');
    }
    this._page = page;
  }

  /**
   * Runs the scan and returns @surea11y/core's native result object.
   * @returns {Promise<object>} see ../core/docs/OUTPUT_SCHEMA.md
   */
  async analyze() {
    const { contextSelector, engineOptions, runOnly } = this._buildEngineArgs();

    // Unlike Playwright's page.evaluate(fn, arg), which only accepts a
    // SINGLE argument (forcing a hand-built single-arg wrapper there --
    // see @surea11y/playwright's own A11yCoreBuilder.js for the full
    // story), Puppeteer's page.evaluate()/frame.evaluate() is genuinely
    // variadic: evaluate<Params extends unknown[], Func>(pageFunction: Func
    // | string, ...args: Params) (confirmed against a real Puppeteer 25.x
    // install's own puppeteer-core/lib/types.d.ts, on the shared abstract
    // Realm class both Page and Frame implement). That means the scan's
    // own 4 positional args can be passed straight through with no
    // wrapper/eval() trick needed -- see ../core/docs/INTEGRATION.md for
    // the documented example this mirrors.
    //
    // An engine error (INVALID_RUN_ONLY, INVALID_CONTEXT_SELECTOR) comes
    // back as a plain object and is thrown here as an EngineError with its
    // `code`; any other error in the page rejects evaluate() as before.
    const runInFrame = async (frameOrPage, frameContextSelector) => {
      const frameUrl = this._url || (typeof frameOrPage.url === 'function' ? frameOrPage.url() : null);
      const result = rethrowEngineError(
        await frameOrPage.evaluate(inPageScan, frameUrl, frameContextSelector, engineOptions, runOnly)
      );
      warnScanGaps(result);
      return this._elementRef ? this._attachElementRefs(frameOrPage, result) : result;
    };

    if (!this._scanFrames) {
      return this._applyReportOnly(await runInFrame(this._page, contextSelector));
    }

    const mainFrame = this._page.mainFrame();
    const topFrame = this._applyReportOnly(await runInFrame(mainFrame, contextSelector));

    // page.frames() includes the main frame itself -- exclude it here since
    // it's already covered by topFrame above, so callers don't have to
    // de-duplicate it themselves out of the frames array.
    const subFrames = this._page.frames().filter((f) => f !== mainFrame);
    const frames = [];
    for (const frame of subFrames) {
      try {
        // include() scopes the top frame only: each sub-frame is scanned
        // whole, as core's own runa11yCoreAcrossFrames does. The selectors
        // were written against the top document, and since core 1.10.0 a
        // selector that matches nothing scans nothing, so passing them on
        // would leave most frames unscanned.
        frames.push(this._applyReportOnly(await runInFrame(frame, null)));
      } catch (e) {
        // A frame can detach/navigate away mid-scan, or be a sandboxed
        // frame the browser blocks scripting in -- don't let one bad frame
        // abort the whole multi-frame scan; report it and keep going.
        frames.push({
          url: (typeof frame.url === 'function' ? frame.url() : null),
          error: (e && e.message) || String(e)
        });
      }
    }

    return { topFrame, frames };
  }

  /**
   * Resolves each fail/cantTell occurrence to a live ElementHandle, scoped
   * to frameOrPage's own document (a Puppeteer Page and Frame both expose
   * evaluateHandle()). An occurrence inside a shadow tree is found through
   * its `shadowHostSelectors` (core 1.10.0 and later): its `selector` holds
   * only inside the last host's shadow root, so `frameOrPage.$(selector)`
   * would find another element, or none.
   * Mutates and returns the same result object -- it's a fresh object from
   * this scan, not shared external state.
   */
  async _attachElementRefs(frameOrPage, result) {
    if (!Array.isArray(result.checksResults)) return result;
    for (const check of result.checksResults) {
      if (!Array.isArray(check.occurrences) || !check.occurrences.length) continue;
      for (const occurrence of check.occurrences) {
        // Most occurrences carry a concrete element selector, but a page-wide
        // finding with no single target element (e.g. some `manual`/cantTell
        // rules) can carry "" -- not every occurrence resolves to one element,
        // so leave elementHandle null without a round trip to the page.
        occurrence.elementHandle = occurrence.selector
          ? await resolveElementHandle(frameOrPage, occurrence)
          : null;
      }
    }
    return result;
  }
}

// Says on the console what the scan left out (an include() scope that
// matched nothing, a custom rule the engine did not run), one line per gap,
// so a scan that skipped something does not pass unnoticed as clean. Once
// per scanned frame; the gaps also stay readable through getScanGaps().
function warnScanGaps(result) {
  for (const gap of getScanGaps(result)) {
    console.warn(`@surea11y/puppeteer: ${gap.message}` + (result.url ? ` (${result.url})` : ''));
  }
}

// The occurrence's element as an ElementHandle, or null when it is gone (or
// a shadow host on the way is). A handle to null is disposed, not leaked.
async function resolveElementHandle(frameOrPage, occurrence) {
  const handle = await frameOrPage.evaluateHandle(
    queryOccurrenceElement,
    occurrence.selector,
    occurrence.shadowHostSelectors || null
  );
  const element = handle.asElement();
  if (!element) await handle.dispose();
  return element;
}

module.exports = { A11yCoreBuilder };
