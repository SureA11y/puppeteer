'use strict';

// src/*.d.ts is written by hand on top of @surea11y/core's and
// @surea11y/binding-base's own types. Compile a typical use of it, so a
// declaration that no longer fits theirs fails here rather than in a
// consumer's build.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('index.d.ts compiles against @surea11y/core\'s and puppeteer\'s types', () => {
  const tsc = require.resolve('typescript/bin/tsc');
  const file = path.join(__dirname, 'types', 'usage.ts');
  try {
    execFileSync(
      process.execPath,
      [tsc, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom', file],
      { stdio: 'pipe' }
    );
  } catch (e) {
    assert.fail(String(e.stdout) + String(e.stderr));
  }
});
