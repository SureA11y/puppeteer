'use strict';

const test = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { A11yCoreBuilder } = require('../src/index.js');

// A "Puppeteer binding" implies working across every browser Puppeteer can
// launch, not just its default Chrome -- every other test in this suite
// only launches puppeteer.launch() with its default 'chrome' browser. This
// proves the injection mechanism itself (frameOrPage.evaluate(runa11yCoreInPage,
// ...args) -- see A11yCoreBuilder.js's own header comment) isn't a
// Chrome-specific accident. Requires `npx puppeteer browsers install
// firefox` locally -- see README.md. Modern Puppeteer's SupportedBrowser
// type is 'chrome' | 'firefox' (confirmed in a real 25.3.0 install's own
// types) -- there is no WebKit option the way Playwright has one.
test('A11yCoreBuilder works against firefox, not just chrome', async () => {
  const browser = await puppeteer.launch({ browser: 'firefox' });
  try {
    const page = await browser.newPage();
    await page.goto('data:text/html,<html><body><img src=x.png><button></button></body></html>');

    const results = await new A11yCoreBuilder({ page }).reportOnly(['fail']).analyze();
    const ruleIds = results.checksResults.map((r) => r.ruleId);

    assert.ok(ruleIds.includes('img-alt-present'));
    assert.ok(ruleIds.includes('button-name-present'));
  } finally {
    await browser.close();
  }
});
