import type { Page, ElementHandle, Frame } from 'puppeteer';
import type * as Core from '@surea11y/core';

// The result shapes are @surea11y/core's own types (shipped since core
// 1.9.0, checked there against real scan results), re-exported under the
// names this file has always used. The binding adds `elementHandle` to an
// occurrence when .elementRef(true) is used, `screenshot` when
// .screenshots() is, and the { topFrame, frames }
// shape of a .frames(true) scan. See core's docs/OUTPUT_SCHEMA.md for what
// each field means.

export type {
  Outcome,
  OutcomeNormalized,
  Severity,
  Confidence,
  RuleType,
  LocaleResolution,
  EngineInfo,
  RenderingEnvironment,
  NormativeMapping,
  VisibilityFilter,
  Uncertainty,
  Margin,
  ContextMatch,
  CompositeResult
} from '@surea11y/core';

// Re-exported from @surea11y/binding-base with the functions src/index.js
// re-exports from it.
export {
  formatFailures,
  getScanGaps,
  getScanNotes,
  formatOccurrenceLocation,
  EngineError
} from '@surea11y/binding-base';
export type {
  ScanGap,
  ScanNote,
  PlannedCheck,
  PlannedCriterion,
  WcagLevelInput,
  EngineErrorCode,
  OccurrenceLocation,
  PackLike,
  WcagVersion,
  WcagLevel,
  ScreenshotOptions,
  ScreenshotSkip,
  ScreenshotBox,
  OccurrenceScreenshot
} from '@surea11y/binding-base';
import type {
  PackLike,
  WcagVersion,
  WcagLevelInput,
  ScanGap,
  ScanNote,
  PlannedCheck,
  PlannedCriterion,
  ScreenshotOptions,
  OccurrenceScreenshot
} from '@surea11y/binding-base';

export type Category = Core.RuleMeta['category'];
export type LocaleResolutionReason = Core.LocaleResolution['reason'];
export type CheckResultMeta = Core.RuleMeta;
export type CompositeResultDetails = Core.CompositeResult['data']['details'];

export interface Occurrence extends Core.Occurrence {
  /**
   * Only present when `.elementRef(true)` was used. `null` when this
   * occurrence has no single resolvable target element (e.g. `selector` was
   * `""`), or the element is no longer in the page -- see
   * A11yCoreBuilder#elementRef.
   */
  elementHandle?: ElementHandle | null;
  /**
   * Only present when `.screenshots()` was used and this occurrence's own
   * outcome is one it pictures: the picture, or why there is none. The
   * occurrences about the same element share one object.
   */
  screenshot?: OccurrenceScreenshot;
}

export interface CheckResult extends Omit<Core.CheckResult, 'occurrences'> {
  occurrences: Occurrence[];
}

/** surea11y's native top-level result shape -- see docs/OUTPUT_SCHEMA.md. */
export interface A11yCoreResult extends Omit<Core.ScanResult, 'checksResults'> {
  checksResults: CheckResult[];
}

/** A sub-frame that couldn't be scanned (detached, navigated away, or sandboxed). */
export interface A11yCoreFrameError {
  url: string | null;
  error: string;
}

/** Returned by analyze() when .frames(true) is enabled, instead of a single A11yCoreResult. */
export interface A11yCoreMultiFrameResult {
  topFrame: A11yCoreResult;
  frames: Array<A11yCoreResult | A11yCoreFrameError>;
}

/**
 * A runtime-registered rule descriptor for `.withCustomRules()` -- the same
 * shape as an internal surea11y rule module's own export (see surea11y's
 * docs/ENGINE_OPTIONS.md). `runInPage`/`applicability` may be passed as
 * either a real function or a function-source string -- `.withCustomRules()`
 * converts a live function to its source string for you, since it must
 * cross a page.evaluate() JSON boundary that cannot carry a live Function
 * reference.
 */
export interface CustomRuleDescriptor {
  id: string;
  meta?: {
    title?: string;
    description?: string;
    tags?: string[];
    defaultSeverity?: Core.Severity;
    defaultConfidence?: Core.Confidence;
    [key: string]: unknown;
  };
  runInPage: ((ctx: unknown) => unknown) | string;
  applicability?: ((ctx: unknown) => boolean) | string;
  data?: Record<string, unknown>;
}

export class A11yCoreBuilder {
  /**
   * @param opts.page A Puppeteer Page, already navigated to and settled at
   *   the URL to scan -- this class does not navigate for you.
   */
  constructor(opts: { page: Page; url?: string });

  /**
   * Installs @surea11y/core's opt-in internals hook in `page`, so a scan can
   * read names, states and roles web components set through a private
   * ElementInternals. Call it before page.goto(): it runs before the page's
   * scripts in every frame and after each navigation.
   */
  static installInternalsHook(page: Page): ReturnType<Page['evaluateOnNewDocument']>;

  /**
   * Installs @surea11y/core's opt-in listener hook (core 1.14.0 and later) in
   * `page`, so the keyboard rules see the listeners a page adds from script.
   * Call it before page.goto(), as installInternalsHook().
   */
  static installListenerHook(page: Page): ReturnType<Page['evaluateOnNewDocument']>;

  /**
   * Installs @surea11y/core's opt-in live-region hook (core 1.14.0 and
   * later): live-region-announcements then also asks about a live region
   * added with its text already in it, or shown and filled at once, and
   * getAnnouncements() reads what the page made available to announce. Call
   * it before page.goto().
   */
  static installLiveRegionHook(page: Page): ReturnType<Page['evaluateOnNewDocument']>;

  /**
   * What the page's live regions were given while shown and reachable, as
   * the live-region hook recorded it, in order; null without the hook. Not
   * what a screen reader said. Needs core 1.14.0 and binding-base 1.6.0.
   */
  static getAnnouncements(
    pageOrFrame: Page | Frame
  ): Promise<Array<{ text: string; politeness: 'polite' | 'assertive'; time: number }> | null>;

  /** Scope the scan to one region. Call multiple times for a multi-region union. */
  include(selector: string): this;
  /**
   * Skip elements matching this selector anywhere in the scanned scope.
   * With `opts.rules`, scopes the exclusion to just the named rule ID(s)
   * instead of globally -- on top of, not instead of, any global exclusions
   * from other `.exclude(selector)` calls.
   */
  exclude(selector: string, opts?: { rules?: string | string[] }): this;
  /** Only run rules carrying at least one of these tags. */
  withTags(tags: string | string[]): this;
  /** Never run rules carrying any of these tags (applied after withTags). */
  disableTags(tags: string | string[]): this;
  /** Only run these specific rule IDs (accepts with or without the `a11ycore-` prefix). */
  withRules(ruleIds: string | string[]): this;
  /** Never run these specific rule IDs (applied after withRules). */
  disableRules(ruleIds: string | string[]): this;
  /**
   * Run the rules for a WCAG conformance target: `withWcag('2.2', 'AA')`
   * runs those of WCAG 2.2's A and AA criteria. withTags()/withRules() add
   * to them. A later call replaces the target.
   */
  withWcag(version: WcagVersion | 2.0 | 2.1 | 2.2, level?: WcagLevelInput): this;
  /** Also run the best-practice rules, those that name no WCAG criterion. */
  withBestPractices(enabled?: boolean): this;
  /**
   * How withRules() and withTags() combine when both are given: 'and' (the
   * default) runs the rules matching both, 'or' those matching either. A
   * later call replaces the mode.
   */
  includeMode(mode: 'and' | 'or'): this;
  /**
   * The WCAG level of the criteria the scan reports, without changing which
   * rules run: `.withRules('contrast-computable').wcagLevel('AA')` reports
   * 1.4.3 and not 1.4.6. Any case; null clears it. A later call replaces it.
   */
  wcagLevel(level: WcagLevelInput | null): this;
  /**
   * Where analyze() sends each scan gap instead of console.warn: called once
   * per gap, with the result of the frame it came from, and once per scan
   * for each of the internals-hook and listener-hook notes (tell them apart
   * by `kind`). `() => {}`
   * silences them, `null` goes back to console.warn. A later call replaces it.
   */
  logger(fn: ((entry: ScanGap | ScanNote, result: A11yCoreResult) => void) | null): this;
  /** Merge arbitrary engineOptions (locale, contrast.mode, policyContract, ...). */
  options(partialEngineOptions: Record<string, unknown>): this;
  /** Register one or more custom rules for just this scan. Call multiple times to accumulate. */
  withCustomRules(rules: CustomRuleDescriptor | CustomRuleDescriptor[]): this;
  /**
   * Packs from `@surea11y/core/pack` (core 1.11 or later): registered in each
   * frame before the scan, and named in `engineOptions.packs`.
   */
  withPacks(packs: PackLike | PackLike[]): this;
  /** Post-filter checksResults down to only the given outcomes. */
  reportOnly(outcomes: Core.Outcome | Core.Outcome[]): this;
  /** Opt in to also scanning every sub-frame on the page (including cross-origin iframes). */
  frames(enabled?: boolean): this;
  /** Opt in to resolving each fail/cantTell occurrence's selector to a live ElementHandle. */
  elementRef(enabled?: boolean): this;
  /**
   * Opt in to a picture of each element the scan flags, on its occurrences'
   * `screenshot` field: a Buffer, or a file in `dir`. `false` turns them
   * off. Throws a TypeError with code 'INVALID_ENGINE_OPTIONS' for an option
   * it can't use.
   */
  screenshots(options?: ScreenshotOptions | boolean): this;
  /**
   * Fetch, from Node, the style sheets the page can't read (another origin's)
   * and give core their text, so checks that read the CSS can check them. On
   * by default; needs @surea11y/core 1.14.0 or later.
   */
  fetchStyleSheets(enabled?: boolean): this;
  /** The rules this scan will run, worked out in Node with no page (@surea11y/core 1.12.0 and later). */
  plannedChecks(): PlannedCheck[];
  /** The criteria this scan will report in rulesResults, worked out in Node with no page. */
  plannedCriteria(): PlannedCriterion[];

  /**
   * Runs the scan. Returns { topFrame, frames } instead of a single result
   * when .frames(true) was used; include() then scopes the top frame only,
   * and each sub-frame is scanned whole. Rejects with an EngineError for
   * input the engine cannot use, with its `code`: 'INVALID_RUN_ONLY'
   * (withRules()/withTags() named no rule or tag it knows),
   * 'INVALID_CONTEXT_SELECTOR' (an include() selector the browser can't
   * parse), 'INVALID_ENGINE_OPTIONS' (an option `strictOptions: true`
   * rejects) or 'PAGE_BUILTINS_BROKEN' (the page's scripts broke a
   * JavaScript built-in the engine relies on).
   */
  analyze(): Promise<A11yCoreResult | A11yCoreMultiFrameResult>;
}

/** The four severities, least to most severe (@surea11y/binding-base 1.6.0 and later). */
export const SEVERITIES: ReadonlyArray<Core.Severity>;

/**
 * The failing rule results that should fail a test: every `fail`, or with
 * `failOnSeverity` only those whose severity is that level or above, as
 * `surea11y scan --fail-on-severity` counts them. `fail` keeps its meaning;
 * the level only picks which failures stop the test. Throws a TypeError for
 * a level that is not a severity. From @surea11y/binding-base 1.6.0.
 */
export function getGatingFailures(
  input: A11yCoreResult | ReadonlyArray<CheckResult>,
  opts?: { failOnSeverity?: Core.Severity }
): CheckResult[];
