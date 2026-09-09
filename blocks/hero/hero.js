import { trackAs, viewAs } from '../../scripts/tracking.js';

export default function decorate(block) {
  const cta = block.querySelector('a[href]');
  if (cta) trackAs(cta, { id: 'hero|cta' });
  // Emit a `view` impression when the hero is actually seen by the reader.
  viewAs(block, { id: 'hero|view' });
}
