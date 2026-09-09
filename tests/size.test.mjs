import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { minify } from 'terser';

test('the generic tracker stays within its delivery budget', async () => {
  const source = await readFile(new URL('../scripts/tracking.js', import.meta.url), 'utf8');
  const { code } = await minify(source, { module: true });
  const minifiedBytes = Buffer.byteLength(code);
  const gzipBytes = gzipSync(code).byteLength;

  assert.ok(minifiedBytes <= 4096, `minified tracker is ${minifiedBytes} bytes`);
  assert.ok(gzipBytes <= 2048, `gzipped tracker is ${gzipBytes} bytes`);
});

test('package metadata identifies the demo repository', async () => {
  const packageJSON = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(packageJSON.name, '@adobe-rnd/aem-clicktracking-demo');
  assert.equal(
    packageJSON.repository.url,
    'git+https://github.com/adobe-rnd/aem-clicktracking-demo.git',
  );
  assert.equal(
    packageJSON.homepage,
    'https://github.com/adobe-rnd/aem-clicktracking-demo#readme',
  );
});
