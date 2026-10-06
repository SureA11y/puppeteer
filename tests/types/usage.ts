// Compiled, not run, by tests/types.test.js.
import type { Page } from 'puppeteer';
import type { ScanResult } from '@surea11y/core';
import {
  A11yCoreBuilder,
  EngineError,
  formatFailures,
  formatOccurrenceLocation,
  getScanGaps
} from '../../src/index';
import type { A11yCoreResult, A11yCoreMultiFrameResult, Occurrence, ScanGap } from '../../src/index';

declare const page: Page;

async function run(): Promise<void> {
  const results = await new A11yCoreBuilder({ page })
    .include('main')
    .withRules(['img-alt-present'])
    .reportOnly(['fail', 'cantTell'])
    .elementRef(true)
    .analyze();

  if ('topFrame' in results) {
    const tree: A11yCoreMultiFrameResult = results;
    for (const frame of tree.frames) {
      if ('error' in frame) String(frame.error);
      else formatFailures(frame);
    }
    return;
  }

  const result: A11yCoreResult = results;
  const version: string = result.engine.version;
  const layout: boolean = result.engine.environment.layout;
  const matched: number | undefined = result.contextMatch?.elementCount;
  const skipped: Array<string | null> = result.skippedCustomRules.map((r) => r.id);
  const gaps: ScanGap[] = getScanGaps(result);
  const message: string = formatFailures(result) + formatFailures(result.checksResults, { outcomes: ['fail'] });

  for (const check of result.checksResults) {
    if (check.margin) check.margin.headroom.toFixed(1);
    for (const occurrence of check.occurrences) {
      const o: Occurrence = occurrence;
      const hosts: string[] | undefined = o.shadowHostSelectors;
      const path: number[] | null = o.structuralPath;
      const where: string = formatOccurrenceLocation(o);
      if (o.elementHandle) await o.elementHandle.dispose();
    }
  }

  // A result from the binding is one of core's results.
  const core: ScanResult = result;
}

async function errors(): Promise<void> {
  try {
    await new A11yCoreBuilder({ page }).withRules('no-such-rule').analyze();
  } catch (e) {
    if (e instanceof EngineError && e.code === 'INVALID_RUN_ONLY') String(e.selector);
  }
}
