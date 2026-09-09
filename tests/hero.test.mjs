import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the hero block annotates its authored CTA and marks itself an impression', async () => {
  const trackAsCalls = [];
  const viewAsCalls = [];
  globalThis.__trackAs = (...args) => trackAsCalls.push(args);
  globalThis.__viewAs = (...args) => { viewAsCalls.push(args); return () => {}; };
  let source = await readFile(new URL('../blocks/hero/hero.js', import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/,
    'const trackAs = globalThis.__trackAs; const viewAs = globalThis.__viewAs;',
  );
  const { default: decorate } = await import(
    `data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`
  );
  const cta = { tagName: 'A' };
  const block = { querySelector: () => cta };

  decorate(block);

  // Unchanged: the authored CTA is still annotated with its stable id.
  assert.deepEqual(trackAsCalls, [[cta, { id: 'hero|cta' }]]);
  // Additive: the hero block registers itself for an impression view.
  assert.equal(viewAsCalls.length, 1);
  assert.equal(viewAsCalls[0][0], block);
  assert.deepEqual(viewAsCalls[0][1], { id: 'hero|view' });
});
