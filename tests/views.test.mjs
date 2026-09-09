import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Real timers captured once, before any test swaps in the fake clock, so a
// failing test can never leak a fake setTimeout into the next module import.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.baseURI = 'https://example.com/products/';
    this.nodes = new Map();
  }

  addEventListener(type, listener, options) {
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

// A controllable clock. The module references setTimeout / clearTimeout as free
// globals inside the dwell timer, so swapping these globals lets a test drive the
// dwell deterministically: nothing fires until flush(), and delays() exposes the
// exact minVisibleMs the module requested.
function installClock() {
  let seq = 0;
  let cleared = 0;
  const timers = new Map();
  globalThis.setTimeout = (fn, ms) => { seq += 1; timers.set(seq, { fn, ms }); return seq; };
  globalThis.clearTimeout = (id) => { if (timers.delete(id)) cleared += 1; };
  return {
    delays: () => [...timers.values()].map((timer) => timer.ms),
    pending: () => timers.size,
    cleared: () => cleared,
    flush: () => {
      const items = [...timers.values()];
      timers.clear();
      items.forEach((timer) => timer.fn());
    },
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

// Fresh document, a counting IntersectionObserver whose callback the test drives,
// and a fake clock. The observer is imported lazily by the module, so `observers`
// stays empty until viewAs is called.
async function setupViews() {
  const document = new FakeDocument();
  globalThis.document = document;
  globalThis.CustomEvent = FakeCustomEvent;
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = [];
      this.unobserved = [];
      this.disconnected = false;
      observers.push(this);
    }

    observe(element) { this.observed.push(element); }

    unobserve(element) { this.unobserved.push(element); }

    disconnect() { this.disconnected = true; }

    emit(entries) { this.callback(entries); }
  };
  // Always import under real timers so the async import machinery is unaffected,
  // then install the fake clock before the synchronous test body drives it.
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  const tracking = await loadTracking();
  const clock = installClock();
  return {
    document, observers, clock, tracking,
  };
}

function elem(tagName = 'A', overrides = {}) {
  return {
    tagName,
    textContent: 'Explore',
    href: 'https://example.com/pricing',
    getAttribute: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    ...overrides,
  };
}

const seen = (target, ratio = 0.6) => ({ isIntersecting: true, intersectionRatio: ratio, target });
const gone = (target) => ({ isIntersecting: false, intersectionRatio: 0, target });

test('viewAs is the fifth public export alongside the click API', async () => {
  const { tracking } = await setupViews();
  assert.deepEqual(Object.keys(tracking).sort(), [
    'configureTracking', 'setPageAttributes', 'track', 'trackAs', 'viewAs',
  ]);
  assert.equal(typeof tracking.viewAs, 'function');
});

test('a view fires once the element is visible for the default 1s dwell', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'hero|view' });
  assert.equal(observers.length, 1);
  assert.deepEqual(observers[0].observed, [block]);

  observers[0].emit([seen(block)]);
  // The dwell has not elapsed: a timer is armed for the default 1000ms, no event.
  assert.deepEqual(clock.delays(), [1000]);
  assert.equal(events.length, 0);

  clock.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'view');
  assert.equal(events[0].id, 'hero|view');
});

test('a view reuses the click envelope shape with event set to view', async () => {
  const {
    document, observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, setPageAttributes, trackAs, viewAs } = tracking;
  const events = [];
  setPageAttributes({ template: 'homepage' });
  configureTracking({ onTrack: (event) => events.push(event) });
  const link = elem('A', { textContent: '  See   pricing\n' });

  // Capture a click envelope for the very same element/annotation.
  trackAs(link, { id: 'hero|pricing' });
  document.click([link]);
  const clickEnvelope = events[0];
  assert.equal(clickEnvelope.event, 'click');

  // The view envelope must be identical except for the event name.
  viewAs(link, { id: 'hero|pricing' });
  observers[0].emit([seen(link)]);
  clock.flush();

  assert.deepEqual(events[1], { ...clickEnvelope, event: 'view' });
});

test('the dwell is honored: dropping below the threshold cancels the pending view', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'hero|view' });
  observers[0].emit([seen(block)]);
  assert.equal(clock.pending(), 1);

  // Scrolled away before the dwell elapsed: the timer is cancelled, nothing fires.
  observers[0].emit([gone(block)]);
  assert.equal(clock.cleared(), 1);
  assert.equal(clock.pending(), 0);
  clock.flush();
  assert.equal(events.length, 0);
});

test('the 50% threshold is honored: below-threshold visibility never arms the dwell', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'hero|view' });
  // 40% visible is below the default 50% policy: no dwell timer is started.
  observers[0].emit([seen(block, 0.4)]);
  assert.equal(clock.pending(), 0);
  clock.flush();
  assert.equal(events.length, 0);
});

test('a fire-once view auto-unobserves and never fires twice', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'hero|view' });
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 1);
  // Auto-unobserved after firing, so a removed / re-seen element cannot leak or
  // re-emit a second impression.
  assert.deepEqual(observers[0].unobserved, [block]);
  observers[0].emit([gone(block)]);
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 1);
});

test('repeat mode re-arms on re-entry and the returned cleanup unobserves', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  const stop = viewAs(block, { id: 'hero|view' }, { once: false });
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 1);
  // Not unobserved in repeat mode.
  assert.deepEqual(observers[0].unobserved, []);

  // Leaves and re-enters the viewability band: a second impression fires.
  observers[0].emit([gone(block)]);
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 2);

  // The returned cleanup unobserves and stops further impressions.
  stop();
  assert.deepEqual(observers[0].unobserved, [block]);
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 2);
});

test('the IntersectionObserver is created lazily, never on a click-only page', async () => {
  const {
    document, observers, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  configureTracking({ onTrack: () => {} });

  // Configuring and clicking install no observer at all.
  const link = elem('A', { getAttribute: (name) => (name === 'href' ? '/x' : null) });
  document.click([link]);
  assert.equal(observers.length, 0);

  // The first viewAs call creates exactly one shared observer.
  viewAs(elem('DIV', { href: undefined }), { id: 'a' });
  viewAs(elem('DIV', { href: undefined }), { id: 'b' });
  assert.equal(observers.length, 1);
});

test('views fan out through onTrack and the eds:track DOM event like clicks', async () => {
  const {
    document, observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const callbackEvents = [];
  const domEvents = [];
  document.addEventListener('eds:track', (event) => domEvents.push(event.detail));
  configureTracking({ onTrack: (event) => callbackEvents.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'hero|view' });
  observers[0].emit([seen(block)]);
  clock.flush();

  assert.equal(callbackEvents.length, 1);
  assert.equal(domEvents.length, 1);
  assert.equal(callbackEvents[0].event, 'view');
  assert.equal(domEvents[0].event, 'view');
});

test('view policy is configurable globally and overridable per call', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  // Global default: a lower threshold and a shorter dwell.
  configureTracking({ onTrack: (event) => events.push(event), view: { threshold: 0.25, minVisibleMs: 400 } });

  const a = elem('DIV', { href: undefined });
  viewAs(a, { id: 'a' });
  observers[0].emit([seen(a, 0.3)]);
  // 30% clears the configured 25% policy, armed for the configured 400ms.
  assert.deepEqual(clock.delays(), [400]);
  clock.flush();
  assert.equal(events.at(-1).id, 'a');

  // Per-call options override the global default.
  const b = elem('DIV', { href: undefined });
  viewAs(b, { id: 'b' }, { threshold: 0.9, minVisibleMs: 50 });
  observers[0].emit([seen(b, 0.5)]);
  // 50% is below the per-call 90% threshold: no dwell.
  assert.equal(clock.pending(), 0);
  observers[0].emit([seen(b, 0.95)]);
  assert.deepEqual(clock.delays(), [50]);
});

test('the observer grid is dense enough to honor off-grid thresholds', async () => {
  const { observers, tracking } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  configureTracking({ onTrack: () => {} });

  viewAs(elem('DIV', { href: undefined }), { id: 'grid' });
  const { threshold } = observers[0].options;
  // A coarse [0, .25, .5, .75, 1] grid would never notify at an off-grid threshold
  // (e.g. 0.6 / 0.9), so a configured value there would silently misfire. The grid
  // must include the documented example thresholds and be denser than quartiles.
  assert.ok(threshold.includes(0.5), 'grid missing 0.5');
  assert.ok(threshold.includes(0.6), 'grid missing 0.6');
  assert.ok(threshold.includes(0.9), 'grid missing 0.9');
  assert.ok(threshold.length > 5, 'grid is not denser than the quartile grid');
});

test('re-registering an element cancels the prior pending dwell', async () => {
  const {
    observers, clock, tracking,
  } = await setupViews();
  const { configureTracking, viewAs } = tracking;
  const events = [];
  configureTracking({ onTrack: (event) => events.push(event) });
  const block = elem('DIV', { href: undefined });

  viewAs(block, { id: 'first' });
  observers[0].emit([seen(block)]); // arms a dwell for the first registration
  assert.equal(clock.pending(), 1);
  viewAs(block, { id: 'second' }); // re-registration must drop the stale dwell
  assert.equal(clock.cleared(), 1);
  assert.equal(clock.pending(), 0);
  observers[0].emit([seen(block)]);
  clock.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'second'); // fires with the current annotation, not the stale one
});
