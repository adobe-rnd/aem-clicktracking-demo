import { track } from '../../scripts/tracking.js';

let sequence = 0;

function slug(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');
}

export default function decorate(block) {
  const [labelRow, ...content] = block.children;
  if (!labelRow) return;

  const heading = labelRow.querySelector('h1, h2, h3, h4, h5, h6');
  const label = (heading || labelRow).textContent.trim() || 'Open dialog';
  const key = heading?.id || slug(label) || 'dialog';
  sequence += 1;
  const id = `dialog-${sequence}`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = label;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', id);

  const dialog = document.createElement('dialog');
  dialog.id = id;
  if (heading) {
    heading.id = `${id}-title`;
    dialog.setAttribute('aria-labelledby', heading.id);
  } else {
    dialog.setAttribute('aria-label', label);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.classList.add('dialog-close');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close dialog');
  dialog.append(close, ...(heading ? [heading] : []), ...content);
  block.replaceChildren(trigger, dialog);

  trigger.addEventListener('click', () => {
    dialog.showModal();
    track('dialog:open', {
      id: `dialog|${key}`,
      label,
      type: 'dialog',
      block: 'dialog',
      state: { open: dialog.open },
    });
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    track('dialog:close', {
      id: `dialog|${key}`,
      label,
      type: 'dialog',
      block: 'dialog',
      state: { open: dialog.open },
    });
  });
}
