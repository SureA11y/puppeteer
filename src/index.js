'use strict';

const { A11yCoreBuilder } = require('./A11yCoreBuilder');
const { formatFailures } = require('./formatFailures');

// Re-exported from @surea11y/binding-base, as formatFailures is, so a test
// needs only this package: what a result says it left out, an occurrence's
// location as text, and the error analyze() throws for input the engine
// cannot use.
const { getScanGaps, formatOccurrenceLocation, EngineError } = require('@surea11y/binding-base');

module.exports = { A11yCoreBuilder, formatFailures, getScanGaps, formatOccurrenceLocation, EngineError };
