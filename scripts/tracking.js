const annotations = new WeakMap();
const page = new Map();
let onTrack;
let listening = false;
let owner;

function sanitize(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function absoluteURL(value) {
  if (!value) return undefined;
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return undefined;
  }
}

function elementContext(element, annotation) {
  const block = element.closest?.('[data-block-name]');
  const section = element.closest?.('.section');
  const sectionStyles = annotation.sectionStyles ?? annotation.context?.sectionStyles
    ?? [...(section?.classList ?? [])].filter((name) => name !== 'section' && !name.endsWith('-container'));
  const heading = section?.querySelector('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
  const blockName = annotation.block ?? annotation.context?.block ?? block?.dataset.blockName;
  const sectionName = annotation.section ?? annotation.context?.section
    ?? heading?.id ?? sectionStyles[0];
  return {
    ...(blockName && { block: blockName }),
    ...(sectionName && { section: sectionName }),
    ...(section && { sectionStyles }),
    ...annotation.context,
  };
}

function clickEvent(element, annotation) {
  const tag = element.tagName?.toLowerCase();
  const label = annotation.label
    ?? element.getAttribute?.('aria-label')
    ?? element.textContent;
  const href = absoluteURL(Object.hasOwn(annotation, 'href') ? annotation.href : element.href);
  return {
    event: 'click',
    id: annotation.id,
    label: sanitize(label),
    type: annotation.type ?? ({ a: 'link', button: 'button' }[tag] ?? tag),
    ...(href && { href }),
    context: elementContext(element, annotation),
    page: Object.fromEntries(page),
  };
}

function deliver(payload) {
  try {
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
  Object.entries(attributes).forEach(([key, value]) => page.set(key, value));
}

export function trackAs(element, annotation) {
  annotations.set(element, annotation);
}

export function track(event, details = {}) {
  const {
    block, section, sectionStyles, context, ...fields
  } = details;
  deliver({
    ...fields,
    event,
    context: {
      ...(block && { block }),
      ...(section && { section }),
      ...(sectionStyles && { sectionStyles }),
      ...context,
    },
    page: Object.fromEntries(page),
  });
}
