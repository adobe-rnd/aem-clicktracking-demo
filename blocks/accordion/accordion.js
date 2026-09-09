import { track } from '../../scripts/tracking.js';

let sequence = 0;

function slug(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');
}

export default function decorate(block) {
  [...block.children].forEach((row) => {
    const [title, panel] = row.children;
    if (!title || !panel) return;

    const heading = title.querySelector('h1, h2, h3, h4, h5, h6');
    const label = (heading || title).textContent.trim();
    const key = heading?.id || slug(label) || 'item';
    sequence += 1;
    const id = `accordion-${sequence}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `${id}-trigger`;
    button.textContent = label;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `${id}-panel`);

    panel.id = `${id}-panel`;
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', button.id);
    (heading || title).replaceChildren(button);

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      panel.hidden = !expanded;
      track(expanded ? 'show' : 'hide', {
        id: `accordion|${key}`,
        label,
        type: 'accordion-item',
        element: button,
        state: { expanded },
      });
    });
  });
}
