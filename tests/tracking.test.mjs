import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.addCalls = [];
    this.baseURI = 'https://example.com/products/';
  }

  addEventListener(type, listener, options) {
    this.addCalls.push({ type, listener, options });
    this.listeners.set(type, { listener, options });
  }

  removeEventListener(type, listener, options) {
    const registered = this.listeners.get(type);
    if (registered?.listener === listener && registered.options === options) {
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event) {
    this.listeners.get(event.type)?.listener(event);
    return true;
  }

  click(path) {
    this.listeners.get('click')?.listener({ composedPath: () => path });
  }
}

class FakeCustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options.detail;
  }
}

async function loadTracking() {
  const source = await readFile(new URL('../scripts/tracking.js', import.meta.url), 'utf8');
  return import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);
}

test('tracking module exposes only the four-function public API', async () => {
  const source = await readFile(new URL('../scripts/tracking.js', import.meta.url), 'utf8');
  const tracking = await loadTracking();

  assert.deepEqual(Object.keys(tracking).sort(), [
    'configureTracking',
    'setPageAttributes',
    'track',
    'trackAs',
  ]);
  Object.values(tracking).forEach((value) => assert.equal(typeof value, 'function'));

  assert.doesNotMatch(source, /^\s*import\s/m);
});

test('trackAs keeps replacement annotations outside the DOM', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  let attributeWrites = 0;
  const link = {
    tagName: 'A',
    textContent: 'Home',
    href: 'https://example.com/',
    closest: () => null,
    setAttribute: () => { attributeWrites += 1; },
  };

  configureTracking({ onTrack: (event) => events.push(event) });
  trackAs(link, { id: 'old' });
  trackAs(link, { id: 'nav|homepage' });
  document.click([link]);

  assert.equal(attributeWrites, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'nav|homepage');
});

test('configuration installs one delegated capture listener with cleanup', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  const link = {
    tagName: 'A', textContent: 'Pricing', href: '/pricing', closest: () => null,
  };
  const icon = { tagName: 'SPAN' };

  configureTracking({ onTrack: (event) => events.push(event) });
  const cleanup = configureTracking({ onTrack: (event) => events.push(event) });
  trackAs(link, { id: 'hero|pricing' });
  document.click([icon, link]);

  assert.equal(document.addCalls.length, 1);
  assert.equal(document.addCalls[0].type, 'click');
  assert.equal(document.addCalls[0].options, true);
  assert.equal(events.length, 1);

  cleanup();
  document.click([icon, link]);
  assert.equal(events.length, 1);
});

test('clicks use the stable envelope with derived and explicit values', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const {
    configureTracking, setPageAttributes, trackAs,
  } = await loadTracking();
  const events = [];
  const link = {
    tagName: 'A',
    textContent: '  See   pricing\n',
    href: 'https://example.com/pricing',
    closest: () => null,
    getAttribute: () => null,
  };

  setPageAttributes({ template: 'homepage' });
  configureTracking({ onTrack: (event) => events.push(event) });
  trackAs(link, { id: 'hero|pricing' });
  document.click([link]);
  setPageAttributes({ template: 'product' });

  assert.deepEqual(events[0], {
    event: 'click',
    id: 'hero|pricing',
    label: 'See pricing',
    type: 'link',
    href: 'https://example.com/pricing',
    context: {},
    page: { template: 'homepage' },
  });

  trackAs(link, {
    id: 'nav|home',
    label: '  Go back   to homepage ',
    type: 'button',
    href: '/',
  });
  document.click([link]);
  assert.equal(events[1].label, 'Go back to homepage');
  assert.equal(events[1].type, 'button');
  assert.equal(events[1].href, 'https://example.com/');
});

test('context derives stable AEM block and section semantics', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  const block = { dataset: { blockName: 'cards' } };
  const heading = { id: 'business-capabilities' };
  const section = {
    classList: ['section', 'cards-container', 'highlight', 'dark'],
    querySelector: () => heading,
  };
  const link = {
    tagName: 'A',
    textContent: 'Explore',
    href: '/explore',
    getAttribute: () => null,
    closest: (selector) => (selector === '[data-block-name]' ? block : section),
  };

  configureTracking({ onTrack: (event) => events.push(event) });
  trackAs(link, { id: 'cards|explore' });
  document.click([link]);
  assert.deepEqual(events[0].context, {
    block: 'cards',
    section: 'business-capabilities',
    sectionStyles: ['highlight', 'dark'],
  });

  section.querySelector = () => null;
  trackAs(link, { id: 'cards|explore', section: 'featured', block: 'promo' });
  document.click([link]);
  assert.deepEqual(events[1].context, {
    block: 'promo',
    section: 'featured',
    sectionStyles: ['highlight', 'dark'],
  });

  trackAs(link, { id: 'cards|explore' });
  document.click([link]);
  assert.equal(events[2].context.section, 'highlight');
  assert.doesNotMatch(JSON.stringify(events), /selector|position|index/);
});

test('DOM and callback hooks receive every event without affecting interaction', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, track, trackAs } = await loadTracking();
  let domEvents = 0;
  let callbackEvents = 0;
  document.addEventListener('eds:track', (event) => {
    domEvents += 1;
    assert.equal(event.detail.id, 'hero|demo');
    throw new Error('customer DOM listener failed');
  });
  configureTracking({
    onTrack: (event) => {
      callbackEvents += 1;
      assert.equal(event.id, 'hero|demo');
      throw new Error('customer callback failed');
    },
  });
  const link = {
    tagName: 'A',
    textContent: 'Demo',
    href: '/demo',
    getAttribute: () => null,
    closest: () => null,
  };
  trackAs(link, { id: 'hero|demo' });

  assert.doesNotThrow(() => document.click([link]));
  assert.doesNotThrow(() => track('dialog:open', { id: 'hero|demo' }));
  assert.equal(domEvents, 2);
  assert.equal(callbackEvents, 2);
});

test('track keeps its event argument authoritative', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, track } = await loadTracking();
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });

  track('dialog:open', { id: 'demo|dialog', event: 'click' });

  assert.equal(events[0].event, 'dialog:open');
});

test('an older cleanup cannot remove a newer configuration', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  const link = {
    tagName: 'A',
    textContent: 'Demo',
    href: '/demo',
    getAttribute: () => null,
    closest: () => null,
  };
  const oldCleanup = configureTracking({ onTrack: () => events.push('old') });
  const newCleanup = configureTracking({ onTrack: () => events.push('new') });
  trackAs(link, { id: 'hero|demo' });

  oldCleanup();
  document.click([link]);
  assert.deepEqual(events, ['new']);

  newCleanup();
  document.click([link]);
  assert.deepEqual(events, ['new']);
});
