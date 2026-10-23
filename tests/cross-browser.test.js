'use strict';

const test = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { A11yCoreBuilder, EngineError } = require('../src/index.js');

// A "Puppeteer binding" implies working across every browser Puppeteer can
// launch, not just its default Chrome -- every other test in this suite
// only launches puppeteer.launch() with its default 'chrome' browser. This
// proves the injection mechanism itself (frameOrPage.evaluate(inPageScan,
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

// Firefox is driven over WebDriver BiDi, not CDP, so what crosses
// evaluate()/evaluateHandle() is serialized differently: check that an
// engine error keeps its code and a shadow-DOM occurrence still resolves to
// its element there too.
test('A11yCoreBuilder keeps engine error codes and resolves shadow-DOM element handles in firefox', async () => {
  const browser = await puppeteer.launch({ browser: 'firefox' });
  try {
    const page = await browser.newPage();
    await page.goto('data:text/html,<html><body><img id="light" src="a.png" alt="Logo"><my-card></my-card></body></html>');
    await page.evaluate(() => {
      document.querySelector('my-card').attachShadow({ mode: 'open' }).innerHTML = '<img id="shadowed" src="b.png">';
    });

    await assert.rejects(
      new A11yCoreBuilder({ page }).withRules(['no-such-rule']).analyze(),
      (e) => e instanceof EngineError && e.code === 'INVALID_RUN_ONLY'
    );

    const results = await new A11yCoreBuilder({ page }).withRules(['img-alt-present']).elementRef(true).analyze();
    const [occurrence] = results.checksResults[0].occurrences;
    assert.strictEqual(await occurrence.elementHandle.evaluate((el) => el.id), 'shadowed');
  } finally {
    await browser.close();
  }
});

test('A11yCoreBuilder runs a pack in every frame in firefox', async () => {
  const browser = await puppeteer.launch({ browser: 'firefox' });
  try {
    const page = await browser.newPage();
    await page.goto(
      'data:text/html,<html><body><video src="a.mp4" autoplay></video>' +
      '<iframe srcdoc="%3Cvideo src=b.mp4 autoplay%3E%3C/video%3E"></iframe></body></html>'
    );
    await page.waitForNetworkIdle().catch(() => {});
    const results = await new A11yCoreBuilder({ page })
      .frames(true)
      .withPacks(require('../examples/acme-policy-pack.js'))
      .withRules('acme-no-autoplay')
      .analyze();
    assert.strictEqual(results.frames.length, 1);
    for (const r of [results.topFrame, results.frames[0]]) {
      assert.deepStrictEqual(r.checksResults.map((c) => [c.ruleId, c.outcome]), [['acme-no-autoplay', 'fail']]);
    }
  } finally {
    await browser.close();
  }
});

test('A11yCoreBuilder.installInternalsHook() works in firefox', async () => {
  const browser = await puppeteer.launch({ browser: 'firefox' });
  try {
    const page = await browser.newPage();
    await A11yCoreBuilder.installInternalsHook(page);
    await page.goto('data:text/html,' + encodeURIComponent(
      '<!doctype html><html lang="en"><head><title>t</title><script>' +
      "customElements.define('x-check', class extends HTMLElement { #i; constructor() { super(); this.#i = this.attachInternals(); this.#i.ariaLabel = 'Subscribe'; this.#i.ariaChecked = 'false'; } });" +
      '</script></head><body><main><h1>Hi</h1><x-check role="checkbox"></x-check></main></body></html>'
    ));
    const results = await new A11yCoreBuilder({ page }).withRules('binary-control-name-present').analyze();
    assert.strictEqual(results.engine.environment.internalsHook, 'early');
    assert.strictEqual(results.checksResults[0].outcome, 'pass');
  } finally {
    await browser.close();
  }
});

test('A11yCoreBuilder.installListenerHook() works in firefox', async () => {
  const browser = await puppeteer.launch({ browser: 'firefox' });
  try {
    const page = await browser.newPage();
    await A11yCoreBuilder.installListenerHook(page);
    await page.goto('data:text/html,' + encodeURIComponent(
      '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1>' +
      '<div id="save" role="button" tabindex="0">Save</div>' +
      "<script>document.getElementById('save').addEventListener('click', () => {});</script>" +
      '</main></body></html>'
    ));
    const results = await new A11yCoreBuilder({ page }).withRules('click-handler-keyboard-operable').analyze();
    assert.strictEqual(results.engine.environment.listenerHook, 'early');
    assert.strictEqual(results.checksResults[0].outcome, 'fail');
  } finally {
    await browser.close();
  }
});
