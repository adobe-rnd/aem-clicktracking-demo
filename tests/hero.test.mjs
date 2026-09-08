import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the hero block annotates its authored CTA', async () => {
  const calls = [];
  globalThis.__trackAs = (...args) => calls.push(args);
  let source = await readFile(new URL('../blocks/hero/hero.js', import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{\s*trackAs\s*\}\s+from\s+['"][^'"]+['"];?/,
    'const trackAs = globalThis.__trackAs;',
  );
  const { default: decorate } = await import(
    `data:text/javascript,${encodeURIComponent(source)}#${Math.random()}`
  );
  const cta = { tagName: 'A' };

  decorate({ querySelector: () => cta });

  assert.deepEqual(calls, [[cta, { id: 'hero|cta' }]]);
});
