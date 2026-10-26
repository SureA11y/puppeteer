'use strict';

const { A11yCoreBuilder } = require('./A11yCoreBuilder');
const { formatFailures } = require('./formatFailures');

// Re-exported from @surea11y/binding-base, as formatFailures is, so a test
// needs only this package: what a result says it left out, how the page was
// scanned (forced colors, the hooks), an occurrence's location as text, the
// error analyze() throws for input the engine cannot use, and the failures
// that fail a test at a severity.
const { getScanGaps, getScanNotes, formatOccurrenceLocation, EngineError, getGatingFailures, SEVERITIES } = require('@surea11y/binding-base');

module.exports = { A11yCoreBuilder, formatFailures, getScanGaps, getScanNotes, formatOccurrenceLocation, EngineError, getGatingFailures, SEVERITIES };
