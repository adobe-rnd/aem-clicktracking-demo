import { trackAs } from '../../scripts/tracking.js';

export default function decorate(block) {
  const cta = block.querySelector('a[href]');
  if (cta) trackAs(cta, { id: 'hero|cta' });
}
