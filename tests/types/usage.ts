// Compiled, not run, by tests/types.test.js.
import type { Page } from 'puppeteer';
import type { ScanResult } from '@surea11y/core';
import { definePack } from '@surea11y/core/pack';
import {
  A11yCoreBuilder,
  EngineError,
  formatFailures,
  formatOccurrenceLocation,
  getScanGaps,
  getScanNotes
} from '../../src/index';
import type { A11yCoreResult, A11yCoreMultiFrameResult, Occurrence, ScanGap } from '../../src/index';

declare const page: Page;

async function run(): Promise<void> {
  await A11yCoreBuilder.installInternalsHook(page);
  const planned = new A11yCoreBuilder({ page }).withWcag('2.2', 'aa').wcagLevel('aa');
  const plannedIds: string[] = planned.plannedChecks().map((c) => c.ruleId).concat(planned.plannedCriteria().map((r) => r.id));
  void plannedIds;

  const results = await new A11yCoreBuilder({ page })
    .include('main')
    .withWcag('2.2', 'AA')
    .withBestPractices()
    .includeMode('or')
    .wcagLevel('AA')
    .logger((entry, frame) => { void `${frame.url}: ${entry.kind} ${entry.message}`; })
    .withRules(['img-alt-present'])
    .withPacks(definePack({ name: '@acme/a11y-rules', version: '1.0.0', namespace: 'acme', core: '^1.11.1' }))
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
  for (const note of getScanNotes(result)) {
    if (note.kind === 'internals-hook') note.elementCount.toFixed();
    else note.message.toUpperCase();
  }
  for (const gap of gaps) {
    if (gap.kind === 'custom-rule-skipped') {
      const id: string | null = gap.rule.id;
    } else if (gap.kind === 'pack-skipped') {
      const name: string | null = gap.pack.name;
    } else {
      const selectors: string[] = gap.selectors;
    }
  }
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
    if (e instanceof EngineError && e.code === 'INVALID_ENGINE_OPTIONS') String(e.message);
  }
}
