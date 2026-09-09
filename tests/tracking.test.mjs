import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.addCalls = [];
    this.baseURI = 'https://example.com/products/';
    this.nodes = new Map();
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

  getElementById(id) {
    return this.nodes.get(id) ?? null;
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

test('each click receives an isolated context snapshot', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  const block = {
    dataset: { blockName: 'cards' },
    classList: ['block', 'cards', 'compact'],
    getAttribute: () => null,
    querySelector: () => null,
  };
  const section = {
    classList: ['section', 'highlight'],
    getAttribute: () => null,
    querySelector: () => null,
  };
  const link = {
    tagName: 'A',
    textContent: 'Explore',
    href: '/explore',
    getAttribute: () => null,
    closest: (selector) => (selector === '[data-block-name]' ? block : section),
  };

  // Context is resolved fresh on each click, so every event owns its derived
  // arrays; a customer mutating one event's context cannot leak into the next.
  configureTracking({
    onTrack: (event) => {
      events.push(event);
      if (events.length === 1) {
        event.context.block = 'mutated';
        event.context.blockStyles.push('mutated');
        event.context.sectionStyles.length = 0;
      }
    },
  });
  trackAs(link, { id: 'cards|explore' });
  document.click([link]);
  document.click([link]);

  assert.deepEqual(events[1].context, {
    block: 'cards',
    blockStyles: ['compact'],
    sectionStyles: ['highlight'],
  });
  assert.notEqual(events[0].context, events[1].context);
  assert.notEqual(events[0].context.blockStyles, events[1].context.blockStyles);
});

test('click labels and types prefer deterministic accessible semantics', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  document.nodes.set('verb', { textContent: '  View ' });
  document.nodes.set('subject', { textContent: ' product details ' });
  document.nodes.set('blank', { textContent: ' \n ' });
  const attributes = {
    'aria-labelledby': 'verb missing subject',
    'aria-label': 'ARIA fallback',
    role: 'button',
  };
  const control = {
    tagName: 'DIV',
    textContent: 'Fallback text',
    closest: () => null,
    getAttribute: (name) => attributes[name] ?? null,
  };

  configureTracking({ onTrack: (event) => events.push(event) });
  trackAs(control, { id: 'product|details' });
  document.click([control]);
  assert.equal(events[0].label, 'View product details');
  assert.equal(events[0].type, 'button');

  trackAs(control, { id: 'product|details', label: ' Explicit label ', type: 'link' });
  document.click([control]);
  assert.equal(events[1].label, 'Explicit label');
  assert.equal(events[1].type, 'link');

  attributes['aria-labelledby'] = 'blank';
  attributes['aria-label'] = 'ARIA fallback';
  ['checkbox', 'radio', 'switch', 'option', 'menuitem'].forEach((role) => {
    attributes.role = role;
    trackAs(control, { id: `control|${role}` });
    document.click([control]);
  });
  assert.deepEqual(events.slice(2).map(({ label, type }) => ({ label, type })), [
    'checkbox', 'radio', 'switch', 'option', 'menuitem',
  ].map((type) => ({ label: 'ARIA fallback', type })));
});

test('context derives stable AEM block and section semantics', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, trackAs } = await loadTracking();
  const events = [];
  document.nodes.set('block-label', { textContent: ' Product cards ' });
  const blockHeading = { id: '', textContent: 'Fallback block heading' };
  const block = {
    dataset: { blockName: 'cards' },
    classList: ['block', 'cards', 'compact', 'cards-container', 'bordered'],
    getAttribute: (name) => ({ 'aria-labelledby': 'block-label', 'aria-label': 'Block fallback' })[name] ?? null,
    querySelector: () => blockHeading,
  };
  const heading = { id: '', textContent: 'Business capabilities' };
  const section = {
    classList: ['section', 'cards-container', 'highlight', 'dark'],
    getAttribute: (name) => (name === 'aria-label' ? 'Support area' : null),
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
    blockSlug: 'product-cards',
    blockStyles: ['compact', 'bordered'],
    section: 'support-area',
    sectionStyles: ['highlight', 'dark'],
  });

  trackAs(link, {
    id: 'cards|explore',
    block: 'ignored-promo',
    section: 'ignored-featured',
    context: {
      block: 'promo',
      blockSlug: 'campaign-promo',
      blockStyles: ['wide'],
      section: 'featured',
      sectionStyles: ['accent'],
    },
  });
  block.classList.push('dynamic');
  section.classList.push('dynamic');
  document.click([link]);
  assert.deepEqual(events[1].context, {
    block: 'promo',
    blockSlug: 'campaign-promo',
    blockStyles: ['wide'],
    section: 'featured',
    sectionStyles: ['accent'],
  });

  block.getAttribute = () => null;
  blockHeading.id = 'featured-cards';
  section.getAttribute = () => null;
  trackAs(link, { id: 'cards|explore' });
  // Context resolves at click time, so classes added after trackAs are reflected.
  block.classList.push('late');
  section.classList.push('late');
  document.click([link]);
  assert.equal(events[2].context.blockSlug, 'featured-cards');
  assert.equal(events[2].context.section, 'business-capabilities');
  assert.deepEqual(events[2].context.blockStyles, ['compact', 'bordered', 'dynamic', 'late']);
  assert.deepEqual(events[2].context.sectionStyles, ['highlight', 'dark', 'dynamic', 'late']);

  block.querySelector = () => null;
  section.querySelector = () => null;
  trackAs(link, { id: 'cards|explore' });
  document.click([link]);
  assert.equal(events[3].context.blockSlug, undefined);
  assert.equal(events[3].context.section, undefined);
  assert.doesNotMatch(JSON.stringify(events), /selector|position|index/);
});

test('explicit events derive context from an element without leaking it', async () => {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const { configureTracking, track } = await loadTracking();
  const events = [];
  const block = {
    dataset: { blockName: 'dialog' },
    classList: ['block', 'dialog', 'wide'],
    getAttribute: () => 'Product demo',
    querySelector: () => null,
  };
  const section = {
    classList: ['section', 'modal-container', 'dark'],
    getAttribute: () => 'Offers',
    querySelector: () => null,
  };
  const element = {
    closest: (selector) => (selector === '[data-block-name]' ? block : section),
  };

  configureTracking({ onTrack: (event) => events.push(event) });
  track('show', {
    element,
    id: 'dialog|product-demo',
    block: 'ignored-dialog',
    blockSlug: 'explicit-demo',
    sectionStyles: ['accent'],
    context: { block: 'dialog', section: 'campaign' },
  });

  assert.deepEqual(events[0].context, {
    block: 'dialog',
    blockSlug: 'explicit-demo',
    blockStyles: ['wide'],
    section: 'campaign',
    sectionStyles: ['accent'],
  });
  assert.equal(Object.hasOwn(events[0], 'element'), false);
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
  assert.doesNotThrow(() => track('show', { id: 'hero|demo' }));
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

  track('show', { id: 'demo|dialog', event: 'click' });

  assert.equal(events[0].event, 'show');
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
