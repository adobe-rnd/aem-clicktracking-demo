import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadPageAttributeExample({ canonical, width }) {
  globalThis.window = {
    innerWidth: width,
    location: {
      hostname: 'example.com',
      origin: 'https://example.com',
      pathname: '/products/',
      search: '?campaign=fall',
      hash: '#details',
    },
    trustedTypes: null,
  };
  globalThis.document = {
    documentElement: { lang: 'fr' },
    querySelector: () => (canonical ? { href: canonical } : null),
  };
  let source = await readFile(new URL('../scripts/scripts.js', import.meta.url), 'utf8');
  source = source
    .replace(/import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\n/g, '')
    .replace(/\nloadPage\(\);\s*$/, '')
    .concat('\nexport { getPageAttributes as __getPageAttributes };');
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);
  return module.__getPageAttributes();
}

test('the project supplies privacy-conscious page context once', async () => {
  assert.deepEqual(await loadPageAttributeExample({
    canonical: 'https://example.com/products/widget',
    width: 767,
  }), {
    language: 'fr',
    url: 'https://example.com/products/widget',
    viewport: 'mobile',
  });

  assert.deepEqual(await loadPageAttributeExample({ canonical: null, width: 768 }), {
    language: 'fr',
    url: 'https://example.com/products/',
    viewport: 'tablet',
  });
  assert.equal((await loadPageAttributeExample({ canonical: null, width: 1199 })).viewport, 'tablet');
  assert.equal((await loadPageAttributeExample({ canonical: null, width: 1200 })).viewport, 'desktop');
});

test('the Adobe adapter maps semantic clicks and lifecycle configuration', async () => {
  const semanticEvent = {
    event: 'click',
    id: 'hero|demo',
    label: 'Watch the demo',
    type: 'link',
    href: 'https://example.com/demo',
    context: { block: 'hero' },
    page: { language: 'en' },
  };
  const calls = [];
  globalThis.window = { trustedTypes: null };
  globalThis.document = {};
  globalThis.__pushEvent = (...args) => calls.push(args);
  let source = await readFile(new URL('../scripts/scripts.js', import.meta.url), 'utf8');
  const projectSource = source;
  source = source
    .replace(/import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\n/g, '')
    .replace(/\nloadPage\(\);\s*$/, '')
    .replace(/^/, 'const pushEventToDataLayer = (...args) => globalThis.__pushEvent(...args);\n')
    .concat('\nexport { sendClickToAdobe as __sendClickToAdobe };');
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);

  module.__sendClickToAdobe(semanticEvent);
  assert.deepEqual(calls, [[
    'eds:track',
    {
      eventType: 'web.webinteraction.linkClicks',
      web: {
        webInteraction: {
          name: 'Watch the demo',
          type: 'other',
          URL: 'https://example.com/demo',
          linkClicks: { value: 1 },
        },
      },
    },
    { eds: { tracking: semanticEvent } },
  ]]);
  assert.match(projectSource, /datastreamId:\s*'cc68fdd3-4db1-432c-adce-288917ddf108'/);
  assert.match(projectSource, /orgId:\s*'908936ED5D35CC220A495CD4@AdobeOrg'/);
  assert.match(projectSource, /clickCollectionEnabled:\s*false/);
  assert.match(projectSource, /personalization:\s*false/);
  assert.match(projectSource, /martechEager\(\)/);
  assert.match(projectSource, /martechLazy\(\)/);
  assert.match(projectSource, /martechDelayed\(\)/);
});

test('Adobe collection remains pending until the project consent event', async () => {
  const calls = [];
  globalThis.window = { trustedTypes: null };
  globalThis.document = {};
  globalThis.__updateConsent = (consent) => calls.push(consent);
  let source = await readFile(new URL('../scripts/scripts.js', import.meta.url), 'utf8');
  const projectSource = source;
  source = source
    .replace(/import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\n/g, '')
    .replace(/\nloadPage\(\);\s*$/, '')
    .replace(/^/, 'const updateUserConsent = (value) => globalThis.__updateConsent(value);\n')
    .concat('\nexport { applyConsent as __applyConsent };');
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);

  module.__applyConsent({ detail: { consented: true } });
  module.__applyConsent({ detail: { consented: false } });
  assert.deepEqual(calls, [
    { collect: true, marketing: false, personalize: false, share: false },
    { collect: false, marketing: false, personalize: false, share: false },
  ]);
  assert.match(projectSource, /defaultConsent:\s*'pending'/);
  assert.match(projectSource, /addEventListener\('consent\.update',\s*applyConsent\)/);
  assert.doesNotMatch(projectSource, /defaultConsent:\s*'in'/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /pending until the project's CMP/i);
  assert.match(readme, /replace.*consent-check\.js/i);
});

test('the AEM lifecycle preserves authored language and runs every martech phase', async () => {
  const calls = [];
  const section = {};
  const main = {
    querySelector: () => section,
    querySelectorAll: () => [],
  };
  const doc = {
    documentElement: { lang: 'fr' },
    body: { classList: { add: () => {} } },
    querySelector: (selector) => ({
      'link[rel="canonical"]': null,
      main,
      'body > header': {},
      'body > footer': {},
    })[selector],
    getElementById: () => null,
  };
  globalThis.document = doc;
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
  globalThis.window = {
    innerWidth: 767,
    hlx: { codeBasePath: '' },
    location: {
      hostname: 'example.com', origin: 'https://example.com', pathname: '/fr/', hash: '',
    },
    trustedTypes: null,
    addEventListener: (name) => calls.push(name),
  };
  globalThis.__calls = calls;
  globalThis.__failSections = false;
  globalThis.__martechMode = 'pending';
  globalThis.__martechInitMode = 'pending';
  globalThis.__martechEagerMode = 'pending';

  let source = await readFile(new URL('../scripts/scripts.js', import.meta.url), 'utf8');
  source = source
    .replace(/import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"];\n/g, '')
    .replace("import('./consent-check.js');", "globalThis.__calls.push('consent-check');")
    .replace(/\nloadPage\(\);\s*$/, '')
    .replace(/^/, `
      const call = (name, value) => { globalThis.__calls.push(name); return value; };
      const adobePromise = (mode, message) => {
        if (mode === 'pending') return new Promise(() => {});
        if (mode === 'reject') return Promise.reject(new Error(message));
        return Promise.resolve();
      };
      const initMartech = () => call(
        'initMartech',
        adobePromise(globalThis.__martechInitMode, 'martech init failed'),
      );
      const martechEager = () => call(
        'martechEager',
        adobePromise(globalThis.__martechEagerMode, 'martech eager failed'),
      );
      const martechLazy = () => call(
        'martechLazy',
        globalThis.__martechMode === 'pending'
          ? new Promise(() => {})
          : Promise.reject(new Error('analytics unavailable')),
      );
      const martechDelayed = () => call('martechDelayed', Promise.resolve());
      const updateUserConsent = () => {};
      const pushEventToDataLayer = () => {};
      const configureTracking = () => call('configureTracking');
      const setPageAttributes = (value) => call('setPageAttributes:' + value.language);
      const decorateTemplateAndTheme = () => call('decorateTemplateAndTheme');
      const loadHeader = () => call('loadHeader');
      const loadFooter = () => call('loadFooter');
      const loadSections = () => call(
        'loadSections',
        globalThis.__failSections
          ? Promise.reject(new Error('core sections failed'))
          : Promise.resolve(),
      );
      const loadCSS = () => call('loadCSS', Promise.resolve());
      const decorateIcons = () => call('decorateIcons');
      const decorateSections = () => call('decorateSections');
      const decorateBlocks = () => call('decorateBlocks');
      const waitForFirstImage = () => {};
      const loadSection = () => call('loadSection', Promise.resolve());
      const buildBlock = () => {};
    `)
    .concat('\nexport { loadEager as __loadEager, loadLazy as __loadLazy, loadDelayed as __loadDelayed, loadPage as __loadPage };');
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);
  const settlesQuickly = (promise) => Promise.race([
    promise.then(() => 'complete'),
    new Promise((resolve) => { setTimeout(() => resolve('timed out'), 25); }),
  ]);

  assert.equal(await settlesQuickly(module.__loadEager(doc)), 'complete');
  assert.ok(calls.includes('decorateBlocks'));
  assert.ok(calls.includes('loadSection'));
  assert.ok(!calls.includes('martechEager'));

  globalThis.__martechInitMode = 'reject';
  await assert.doesNotReject(() => module.__loadEager(doc));
  assert.ok(!calls.includes('martechEager'));

  globalThis.__martechInitMode = 'resolve';
  assert.equal(await settlesQuickly(module.__loadEager(doc)), 'complete');
  assert.ok(calls.includes('martechEager'));

  globalThis.__martechEagerMode = 'reject';
  await assert.doesNotReject(() => module.__loadEager(doc));
  const lazyOutcome = await Promise.race([
    module.__loadLazy(doc).then(() => 'complete'),
    new Promise((resolve) => { setTimeout(() => resolve('timed out'), 25); }),
  ]);
  assert.equal(lazyOutcome, 'complete');

  globalThis.__martechEagerMode = 'pending';
  assert.equal(await settlesQuickly(module.__loadPage()), 'complete');
  assert.ok(calls.includes('consent-check'));

  globalThis.__martechMode = 'reject';
  await assert.doesNotReject(() => module.__loadLazy(doc));
  module.__loadDelayed();

  assert.equal(doc.documentElement.lang, 'fr');
  assert.ok(calls.includes('setPageAttributes:fr'));
  ['initMartech', 'martechEager', 'martechLazy', 'martechDelayed', 'consent.update']
    .forEach((name) => assert.ok(calls.includes(name), `${name} did not run`));
  ['loadFooter', 'loadCSS'].forEach((name) => {
    assert.ok(calls.includes(name), `${name} did not run after martech failure`);
  });

  calls.length = 0;
  globalThis.__martechInitMode = 'resolve';
  globalThis.__martechEagerMode = 'pending';
  globalThis.__martechMode = 'pending';
  assert.equal(await settlesQuickly(module.__loadPage()), 'complete');
  ['loadFooter', 'loadCSS', 'consent-check'].forEach((name) => {
    assert.ok(calls.includes(name), `${name} did not run after eager martech stalled`);
  });

  globalThis.__failSections = true;
  globalThis.__martechMode = 'pending';
  await assert.rejects(() => module.__loadLazy(doc), /core sections failed/);
});
