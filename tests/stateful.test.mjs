import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class Element {
  constructor(tagName = 'div', text = '') {
    this.tagName = tagName.toUpperCase();
    this._textContent = text;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)) };
    this.classes = new Set();
    this.hidden = false;
    this.open = false;
  }

  get textContent() {
    return this._textContent || this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  attach(child) {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
    }
    child.parentElement = this;
    return child;
  }

  append(...children) {
    this._textContent = '';
    this.children.push(...children.map((child) => this.attach(child)));
  }

  replaceChildren(...children) {
    this._textContent = '';
    this.children = children.map((child) => this.attach(child));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    const tags = selector.split(',').map((tag) => tag.trim().toUpperCase());
    for (const child of this.children) {
      if (tags.includes(child.tagName)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    (this.listeners.get(type) ?? []).forEach((listener) => listener());
  }

  click() {
    this.dispatch('click');
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatch('close');
  }
}

async function loadBlock(name, track) {
  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  globalThis.__track = track;
  let source = await readFile(
    new URL(`../blocks/${name}/${name}.js`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{\s*track\s*\}\s+from\s+['"][^'"]+['"];?/,
    'const track = globalThis.__track;',
  );
  return import(`data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`);
}

function findById(element, id) {
  if (element.id === id) return element;
  for (const child of element.children) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

function accordionBlock(label, headingId) {
  const title = new Element();
  const heading = headingId ? new Element('h3', label) : null;
  if (heading) {
    heading.id = headingId;
    title.append(heading);
  } else {
    title.textContent = label;
  }
  const panel = new Element('div', `${label} details`);
  const row = new Element();
  row.append(title, panel);
  const block = new Element();
  block.append(row);
  return {
    block, heading, panel, title,
  };
}

test('accordion updates ARIA state before reporting show and hide events', async () => {
  const events = [];
  let activeButton;
  let activePanel;
  const { default: decorate } = await loadBlock('accordion', (event, detail) => {
    events.push({
      event,
      detail,
      expanded: activeButton.getAttribute('aria-expanded'),
      hidden: activePanel.hidden,
    });
  });
  const first = accordionBlock('Shipping', 'shipping');
  const repeated = accordionBlock('Shipping', 'shipping');
  const noHeading = accordionBlock('配送');

  decorate(first.block);
  decorate(repeated.block);
  decorate(noHeading.block);
  assert.equal(first.title.children[0], first.heading);
  const button = first.heading.children[0];
  const repeatedButton = repeated.heading.children[0];
  const fallbackButton = noHeading.title.children[0];
  activeButton = button;
  activePanel = first.panel;
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(findById(first.block, button.getAttribute('aria-controls')), first.panel);
  assert.equal(findById(first.block, first.panel.getAttribute('aria-labelledby')), button);
  assert.equal(first.panel.getAttribute('role'), 'region');
  assert.equal(first.panel.hidden, true);
  assert.notEqual(button.id, repeatedButton.id);
  assert.notEqual(first.panel.id, repeated.panel.id);
  assert.equal(fallbackButton.textContent, '配送');

  button.click();
  button.click();
  activeButton = repeatedButton;
  activePanel = repeated.panel;
  repeatedButton.click();
  activeButton = fallbackButton;
  activePanel = noHeading.panel;
  fallbackButton.click();

  assert.deepEqual(events, [
    {
      event: 'show',
      detail: {
        id: 'accordion|shipping',
        label: 'Shipping',
        type: 'accordion-item',
        element: button,
        state: { expanded: true },
      },
      expanded: 'true',
      hidden: false,
    },
    {
      event: 'hide',
      detail: {
        id: 'accordion|shipping',
        label: 'Shipping',
        type: 'accordion-item',
        element: button,
        state: { expanded: false },
      },
      expanded: 'false',
      hidden: true,
    },
    {
      event: 'show',
      detail: {
        id: 'accordion|shipping',
        label: 'Shipping',
        type: 'accordion-item',
        element: repeatedButton,
        state: { expanded: true },
      },
      expanded: 'true',
      hidden: false,
    },
    {
      event: 'show',
      detail: {
        id: 'accordion|配送',
        label: '配送',
        type: 'accordion-item',
        element: fallbackButton,
        state: { expanded: true },
      },
      expanded: 'true',
      hidden: false,
    },
  ]);
});

test('native dialog reports show and hide events after state changes', async () => {
  const events = [];
  const makeBlock = (label = 'Product demo', headingId = 'product-demo') => {
    const heading = headingId ? new Element('h2', label) : null;
    if (heading) heading.id = headingId;
    const labelRow = new Element();
    if (heading) labelRow.append(heading);
    else labelRow.textContent = label;
    const content = new Element('div', 'Demo content');
    const block = new Element();
    block.append(labelRow, content);
    return { block, heading };
  };
  let activeDialog;
  const { default: decorate } = await loadBlock('dialog', (event, detail) => {
    events.push({ event, detail, open: activeDialog.open });
  });
  const first = makeBlock();
  const repeated = makeBlock();
  const noHeading = makeBlock('製品デモ', null);

  decorate(first.block);
  decorate(repeated.block);
  const [trigger, dialog] = first.block.children;
  const [repeatedTrigger, repeatedDialog] = repeated.block.children;
  const close = dialog.children[0];
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(findById(first.block, trigger.getAttribute('aria-controls')), dialog);
  assert.equal(findById(dialog, dialog.getAttribute('aria-labelledby')), first.heading);
  assert.notEqual(dialog.id, repeatedDialog.id);
  assert.notEqual(first.heading.id, repeated.heading.id);
  assert.equal(close.getAttribute('aria-label'), 'Close dialog');

  activeDialog = dialog;
  trigger.click();
  dialog.close();
  activeDialog = repeatedDialog;
  repeatedTrigger.click();
  repeatedDialog.close();

  assert.deepEqual(events, [
    {
      event: 'show',
      detail: {
        id: 'dialog|product-demo',
        label: 'Product demo',
        type: 'dialog',
        element: trigger,
        state: { open: true },
      },
      open: true,
    },
    {
      event: 'hide',
      detail: {
        id: 'dialog|product-demo',
        label: 'Product demo',
        type: 'dialog',
        element: dialog,
        state: { open: false },
      },
      open: false,
    },
    {
      event: 'show',
      detail: {
        id: 'dialog|product-demo',
        label: 'Product demo',
        type: 'dialog',
        element: repeatedTrigger,
        state: { open: true },
      },
      open: true,
    },
    {
      event: 'hide',
      detail: {
        id: 'dialog|product-demo',
        label: 'Product demo',
        type: 'dialog',
        element: repeatedDialog,
        state: { open: false },
      },
      open: false,
    },
  ]);

  decorate(noHeading.block);
  const [fallbackTrigger, fallbackDialog] = noHeading.block.children;
  assert.equal(fallbackDialog.getAttribute('aria-label'), '製品デモ');
  assert.equal(findById(noHeading.block, fallbackTrigger.getAttribute('aria-controls')), fallbackDialog);
  activeDialog = fallbackDialog;
  fallbackTrigger.click();
  fallbackDialog.close();
  assert.deepEqual(events.slice(-2).map(({ event, detail }) => ({ event, detail })), [
    {
      event: 'show',
      detail: {
        id: 'dialog|製品デモ',
        label: '製品デモ',
        type: 'dialog',
        element: fallbackTrigger,
        state: { open: true },
      },
    },
    {
      event: 'hide',
      detail: {
        id: 'dialog|製品デモ',
        label: '製品デモ',
        type: 'dialog',
        element: fallbackDialog,
        state: { open: false },
      },
    },
  ]);
});

test('stateful examples do not add component inference or duplicate click tracking', async () => {
  const [accordion, dialog, tracking] = await Promise.all([
    readFile(new URL('../blocks/accordion/accordion.js', import.meta.url), 'utf8'),
    readFile(new URL('../blocks/dialog/dialog.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/tracking.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(accordion, /trackAs/);
  assert.doesNotMatch(dialog, /trackAs/);
  assert.doesNotMatch(tracking, /accordion|dialog/i);
});

test('README documents the portable stateful pattern and pinned subtree update', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /update.*ARIA.*before.*track\(\)/is);
  assert.match(readme, /`show` and `hide`/);
  assert.match(readme, /type.*`accordion-item`/s);
  assert.match(readme, /type.*`dialog`/s);
  assert.match(
    readme,
    /git subtree pull --squash --prefix plugins\/martech git@github\.com:adobe-rnd\/aem-martech\.git 1aa3dee3c4791636efa9ad2994342f861c8e149b/,
  );
});

test('the local draft demonstrates every tracked block', async () => {
  const [fixture, readme] = await Promise.all([
    readFile(new URL('../drafts/index.plain.html', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ]);

  assert.match(fixture, /<main>/);
  ['hero', 'accordion', 'dialog'].forEach((name) => {
    assert.match(fixture, new RegExp(`class="${name}"`));
  });
  assert.match(fixture, /<h3 id="shipping">Shipping<\/h3>/);
  assert.match(fixture, /<h2 id="product-demo">Product demo<\/h2>/);
  assert.match(readme, /aem-cli up --html-folder drafts/);
});
