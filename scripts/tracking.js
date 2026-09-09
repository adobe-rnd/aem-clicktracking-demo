const annotations = new WeakMap();
const page = {};
const contextFields = ['block', 'blockSlug', 'blockStyles', 'section', 'sectionStyles'];
let onTrack;
let listening = false;
let owner;

function sanitize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// The authored accessible name only: `aria-labelledby` text, then `aria-label`.
// Identity/slug derivation uses this, so authored names — never element content
// — feed stable slugs.
function accessibleName(element) {
  const labelledBy = element?.getAttribute?.('aria-labelledby');
  const referenced = sanitize(labelledBy?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent).join(' '));
  return referenced || sanitize(element?.getAttribute?.('aria-label'));
}

// Approximates a control's accessible name for the human click label without
// touching the browser accessibility tree. Resolution order (first non-empty
// wins): authored aria name, then visible text — falling back to a descendant
// `<img alt>` so icon/image-labeled controls are named — then the `title`
// attribute, then an associated `<label>` (`element.labels` covers both
// `label[for=id]` and a wrapping `<label>`). Content feeds only this label,
// never the slug above, so display copy cannot leak into stable identity.
function clickLabel(element) {
  const content = sanitize(element?.textContent)
    || sanitize([...(element?.querySelectorAll?.('img') ?? [])]
      .map((img) => img.getAttribute?.('alt')).join(' '));
  return accessibleName(element)
    || content
    || sanitize(element?.getAttribute?.('title'))
    || sanitize([...(element?.labels ?? [])].map((node) => node.textContent).join(' '));
}

function slug(value) {
  return sanitize(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function absoluteURL(value) {
  if (!value) return undefined;
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return undefined;
  }
}

// Best-effort descriptive slug, not guaranteed-stable identity. Prefers an
// explicit authored id (the element's own `id`), then the authored accessible
// name, then the first heading's `id`, then its slugified text.
function identity(element) {
  const heading = element?.querySelector?.('h1,h2,h3,h4,h5,h6');
  return element?.id
    || slug(accessibleName(element))
    || heading?.id
    || slug(heading?.textContent);
}

// Blocks pass their block name (drops the `block` marker plus the name class);
// sections pass no name (drops the `section` marker). Generated `*-container`
// wrappers are never styles.
function styles(element, name) {
  return [...(element?.classList ?? [])]
    .filter((value) => value !== (name ? 'block' : 'section')
      && value !== name && !value.endsWith('-container'));
}

function elementContext(element, annotation = {}) {
  const block = element?.closest?.('[data-block-name]');
  const section = element?.closest?.('.section');
  // Page-chrome fallback: a click outside any .section but inside a header,
  // footer, or nav carries that region name as `section` (no sectionStyles).
  // A real .section always wins.
  const region = !section && element?.closest?.('header,footer,nav');
  const blockName = block?.dataset.blockName;
  const blockSlug = identity(block);
  const sectionSlug = section ? identity(section) : region?.tagName?.toLowerCase();
  const context = {
    ...(blockName && { block: blockName }),
    ...(blockSlug && { blockSlug }),
    ...(block && { blockStyles: styles(block, blockName) }),
    ...(sectionSlug && { section: sectionSlug }),
    ...(section && { sectionStyles: styles(section) }),
  };
  contextFields.forEach((key) => {
    if (key in annotation) context[key] = annotation[key];
  });
  return { ...context, ...annotation.context };
}

function clickEvent(element, annotation) {
  const tag = element.tagName?.toLowerCase();
  const role = element.getAttribute?.('role');
  const label = annotation.label ?? clickLabel(element);
  const href = absoluteURL('href' in annotation ? annotation.href : element.href);
  return {
    event: 'click',
    id: annotation.id,
    label: sanitize(label),
    type: annotation.type ?? (/^(button|link|tab|checkbox|radio|switch|option|menuitem)$/.test(role)
      ? role : ({ a: 'link' }[tag] ?? tag)),
    ...(href && { href }),
    context: elementContext(element, annotation),
    page: { ...page },
  };
}

function deliver(payload) {
  try {
    // Unconditional: the eds:track DOM event fires for every tracked
    // interaction regardless of consent. The producer does not gate this DOM
    // path; enforcing consent before delivery is the consumer's / adapter's
    // responsibility (see README).
    document.dispatchEvent(new CustomEvent('eds:track', { detail: payload }));
  } catch {
    // Customer listeners must not affect the interaction.
  }
  try {
    onTrack?.(payload);
  } catch {
    // Customer callbacks must not affect the interaction.
  }
}

function handleClick(event) {
  const element = event.composedPath().find((node) => annotations.has(node));
  if (element) deliver(clickEvent(element, annotations.get(element)));
}

export function configureTracking(options = {}) {
  const current = {};
  owner = current;
  onTrack = options.onTrack;
  if (!listening) {
    document.addEventListener('click', handleClick, true);
    listening = true;
  }
  return () => {
    if (!listening || owner !== current) return;
    document.removeEventListener('click', handleClick, true);
    listening = false;
  };
}

export function setPageAttributes(attributes) {
  Object.assign(page, attributes);
}

export function trackAs(element, annotation) {
  annotations.set(element, annotation);
}

export function track(event, details = {}) {
  const fields = { ...details };
  const { element } = details;
  [...contextFields, 'element'].forEach((key) => delete fields[key]);
  deliver({
    ...fields,
    event,
    context: elementContext(element, details),
    page: { ...page },
  });
}
