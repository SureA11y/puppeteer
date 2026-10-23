'use strict';

const {
  runa11yCoreInPage,
  internalsHookScript,
  listenerHookScript,
  liveRegionHookScript,
  getAnnouncements
} = require('@surea11y/core');
const {
  A11yCoreBuilderBase,
  createInPageScan,
  rethrowEngineError,
  queryOccurrenceElement,
  createInPageAnnouncements
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
 * Or let the scan take a picture of each element it flags, with
 * `.screenshots()` (@surea11y/binding-base's, see its README): each
 * occurrence gets a `screenshot` field, the picture (a Buffer, or a file in
 * `dir`) or why there is none. The element is scrolled into view and marked
 * with a box drawn over the page, and the page is put back afterwards; in
 * every frame with `.frames(true)`, including cross-origin ones:
 *
 * const results = await new A11yCoreBuilder({ page })
 *   .screenshots({ dir: 'a11y-shots', padding: 16 })
 *   .analyze();
 * // results.checksResults[i].occurrences[j].screenshot
 * //   -> { path: 'a11y-shots/element-3f9a1c07.png', box: { x, y, width, height } }
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
 * reportOnly()/frames()/elementRef()/screenshots() are the exception: each
 * call replaces the previous value rather than merging with it.
 */
class A11yCoreBuilder extends A11yCoreBuilderBase {
  /**
   * @param {{ page: import('puppeteer').Page, url?: string }} opts
   *   `page` must already be navigated to and settled at the URL to scan --
   *   this class does not navigate for you.
   */
  /**
   * Installs @surea11y/core's opt-in internals hook in `page`, so a scan can
   * read the names, states and roles web components set through a private
   * ElementInternals. Call it before page.goto(): Puppeteer runs the script
   * before the page's own scripts in every frame, and again after each
   * navigation (page.evaluateOnNewDocument()). The page already loaded when
   * it is called doesn't get it, nor does a tab the page opens itself.
   * Resolves to what evaluateOnNewDocument() resolves to.
   * @param {import('puppeteer').Page} page
   */
  static installInternalsHook(page) {
    if (!page || typeof page.evaluateOnNewDocument !== 'function') {
      throw new TypeError('A11yCoreBuilder.installInternalsHook() requires a Puppeteer Page (with an .evaluateOnNewDocument() method).');
    }
    return page.evaluateOnNewDocument(internalsHookScript());
  }

  /**
   * Installs @surea11y/core's opt-in listener hook (core 1.14.0 and later) in
   * `page`, so the keyboard rules see the click, key, focus and mouse
   * listeners a page adds from script (addEventListener, or an
   * onclick-style property), not only inline handler attributes. Call it
   * before page.goto(), as installInternalsHook(). Resolves to what
   * evaluateOnNewDocument() resolves to.
   * @param {import('puppeteer').Page} page
   */
  static installListenerHook(page) {
    if (!page || typeof page.evaluateOnNewDocument !== 'function') {
      throw new TypeError('A11yCoreBuilder.installListenerHook() requires a Puppeteer Page (with an .evaluateOnNewDocument() method).');
    }
    if (typeof listenerHookScript !== 'function') {
      throw new TypeError('A11yCoreBuilder.installListenerHook() needs @surea11y/core 1.14.0 or later, which has listenerHookScript().');
    }
    return page.evaluateOnNewDocument(listenerHookScript());
  }

  /**
   * Installs @surea11y/core's opt-in live-region hook (core 1.14.0 and
   * later) in `page`, which records what the page's live regions are given
   * from the load event on: live-region-announcements then asks about a
   * region added with its text already in it, or shown and filled at once,
   * and getAnnouncements() reads what the page made available to announce.
   * Call it before page.goto(). Resolves to what evaluateOnNewDocument()
   * resolves to.
   * @param {import('puppeteer').Page} page
   */
  static installLiveRegionHook(page) {
    if (!page || typeof page.evaluateOnNewDocument !== 'function') {
      throw new TypeError('A11yCoreBuilder.installLiveRegionHook() requires a Puppeteer Page (with an .evaluateOnNewDocument() method).');
    }
    if (typeof liveRegionHookScript !== 'function') {
      throw new TypeError('A11yCoreBuilder.installLiveRegionHook() needs @surea11y/core 1.14.0 or later, which has liveRegionHookScript().');
    }
    return page.evaluateOnNewDocument(liveRegionHookScript());
  }

  /**
   * What the page's live regions were given while shown and reachable by
   * assistive technology, as the live-region hook recorded it:
   * [{ text, politeness, time }] in the order the page did it, or null when
   * the page has no hook. What the page made available to announce, not what
   * a screen reader said. Takes a Page or a Frame.
   * @param {import('puppeteer').Page | import('puppeteer').Frame} pageOrFrame
   * @returns {Promise<Array<{ text: string, politeness: 'polite' | 'assertive', time: number }> | null>}
   */
  static async getAnnouncements(pageOrFrame) {
    if (!pageOrFrame || typeof pageOrFrame.evaluate !== 'function') {
      throw new TypeError('A11yCoreBuilder.getAnnouncements() requires a Puppeteer Page or Frame (with an .evaluate() method).');
    }
    if (typeof getAnnouncements !== 'function' || typeof createInPageAnnouncements !== 'function') {
      throw new TypeError('A11yCoreBuilder.getAnnouncements() needs @surea11y/core 1.14.0 and @surea11y/binding-base 1.6.0 or later.');
    }
    return pageOrFrame.evaluate(createInPageAnnouncements(getAnnouncements));
  }

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
    // The script that registers withPacks()'s packs in a frame, which the
    // scan names in engineOptions.packs; null without packs.
    const packScript = this._packScript();

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
      if (packScript) await frameOrPage.evaluate(packScript);
      // The text of the style sheets the frame can't read, fetched from Node
      // (binding-base 1.6.0 and core 1.14.0; nothing with older ones).
      const frameEngineOptions =
        typeof this._styleSheetEngineOptions === 'function'
          ? await this._styleSheetEngineOptions(frameOrPage, engineOptions)
          : engineOptions;
      const result = rethrowEngineError(
        await frameOrPage.evaluate(inPageScan, frameUrl, frameContextSelector, frameEngineOptions, runOnly)
      );
      this._warnScanGaps(result, '@surea11y/puppeteer');
      // Right after the frame's scan, before reportOnly(): nothing unless
      // .screenshots() was called.
      if (this._screenshots) await this._screenshotFrame(frameOrPage, result);
      return this._elementRef ? this._attachElementRefs(frameOrPage, result) : result;
    };

    // .conditions() (binding-base 1.6.0): the page as it is, then under each
    // condition, merged into one result.
    if (this._conditions) {
      return this._applyReportOnly(
        await this._scanUnderConditions(() => runInFrame(this._page, contextSelector), this._conditionDriver())
      );
    }

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
  /**
   * binding-base's screenshots step for one scanned frame (or the page),
   * with the <iframe>s leading to it: each frame's frameElement(), a handle
   * in its parent, disposed afterwards.
   */
  async _screenshotFrame(frameOrPage, result) {
    const framePath = [];
    const parentOf = (f) => (typeof f.parentFrame === 'function' ? f.parentFrame() : null);
    for (let f = frameOrPage; parentOf(f); f = parentOf(f)) {
      // null when the frame detached after its scan: binding-base fails
      // that frame's pictures.
      const iframe = await f.frameElement().catch(() => null);
      framePath.unshift({ frame: parentOf(f), iframe });
    }
    try {
      await this._captureScreenshots(result, frameOrPage, framePath);
    } finally {
      await Promise.all(framePath.map((step) => (step.iframe ? step.iframe.dispose().catch(() => {}) : null)));
    }
  }

  /** For binding-base's screenshots step: runs `fn(...args)` in the frame. */
  _evaluateInFrame(frameOrPage, fn, args) {
    return frameOrPage.evaluate(fn, ...args);
  }

  /**
   * For binding-base's screenshots step: a PNG of `box`, CSS pixels in the
   * viewport. Puppeteer's clip is relative to the document, so the box is
   * moved by the page's scroll; captureBeyondViewport: false keeps Chrome
   * from laying the page out again for the picture, as the default would.
   */
  _captureBox(box, view) {
    return this._page.screenshot({
      clip: { x: box.x + view.scroll.x, y: box.y + view.scroll.y, width: box.width, height: box.height },
      captureBeyondViewport: false
    });
  }

  /**
   * The driver steps .conditions() scans need: the viewport's width with
   * page.setViewport() (the rest of the viewport kept) and the color scheme
   * with page.emulateMediaFeatures(). Each condition sets both, from the
   * page as it was, so one condition's width or scheme doesn't carry into
   * the next; at the end the viewport goes back, and the page is left dark
   * if it was dark before (a scheme emulated by the caller, or the
   * system's), or with the scheme no longer emulated.
   */
  _conditionDriver() {
    const page = this._page;
    let viewport = null;
    // The scheme a condition without one goes back to: the one the page was
    // in, named, since clearing the emulation would give the system's, which
    // a caller may have emulated away from.
    let baseScheme = 'light';
    const scheme = (value) => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]);
    return {
      save: async () => {
        const before = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          deviceScaleFactor: devicePixelRatio,
          dark: matchMedia('(prefers-color-scheme: dark)').matches
        }));
        viewport = page.viewport() || { width: before.width, height: before.height, deviceScaleFactor: before.deviceScaleFactor };
        baseScheme = before.dark ? 'dark' : 'light';
        return { viewport };
      },
      apply: async (condition) => {
        await page.setViewport({ ...viewport, width: condition.width || viewport.width });
        await scheme(condition.colorScheme || baseScheme);
      },
      restore: async (state) => {
        if (!state) return;
        await page.setViewport(state.viewport);
        await scheme(baseScheme);
      }
    };
  }

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
