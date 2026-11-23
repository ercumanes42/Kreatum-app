import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

const functionsDirectory = fileURLToPath(new URL('../', import.meta.url));
const vendorDirectory = new URL('../vendor/pptxgenjs/', import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

test('vendored PptxGenJS preserves upstream bytes and removes only the unused dependency', () => {
  const provenance = readJson(new URL('PROVENANCE.json', vendorDirectory));
  assert.equal(provenance.version, '4.0.1');
  assert.equal(Object.keys(provenance.files).length, 10);
  for (const [file, expected] of Object.entries(provenance.files)) {
    const actual = createHash('sha256').update(readFileSync(new URL(file, vendorDirectory))).digest('hex');
    assert.equal(actual, expected, `Upstream file modified: ${file}`);
  }
  const original = readJson(new URL('upstream.package.json', vendorDirectory));
  assert.equal(original.dependencies['image-size'], '^1.2.1');
  delete original.dependencies['image-size'];
  assert.deepEqual(readJson(new URL('package.json', vendorDirectory)), original);
});

test('image-size is absent from installed dependencies and the Functions lock', () => {
  const require = createRequire(import.meta.url);
  assert.throws(() => require.resolve('image-size'), { code: 'MODULE_NOT_FOUND' });
  const lock = readJson(new URL('../package-lock.json', import.meta.url));
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert.equal(/(^|\/)node_modules\/image-size$/.test(name), false, name);
    assert.equal(Object.hasOwn(entry.dependencies ?? {}, 'image-size'), false, name);
  }
  assert.equal(lock.packages[''].dependencies.pptxgenjs, 'file:vendor/pptxgenjs-4.0.1.tgz');
  assert.equal(lock.packages['node_modules/pptxgenjs'].link, undefined);
  assert.equal(Object.keys(lock.packages).some((name) => name.endsWith('/gulp-delete-lines')), false);
});

test('distributed tarball and installed package match the reviewed sources exactly', () => {
  const provenance = readJson(new URL('PROVENANCE.json', vendorDirectory));
  const archive = readFileSync(new URL(provenance.distributionFile, vendorDirectory));
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
  assert.equal(integrity, provenance.distributionIntegrity);
  const lock = readJson(new URL('../package-lock.json', import.meta.url));
  assert.equal(lock.packages['node_modules/pptxgenjs'].integrity, integrity);
  const tar = gunzipSync(archive);
  let offset = 0;
  const files = [];
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const type = String.fromCharCode(header[156]);
    offset += 512;
    const data = tar.subarray(offset, offset + size);
    if (type === '0' || type === '\0') {
      assert.ok(name.startsWith('package/') && !name.includes('..'));
      const relative = name.slice('package/'.length);
      files.push(relative);
      assert.deepEqual(data, readFileSync(new URL(relative, vendorDirectory)), `Archive differs: ${relative}`);
      assert.deepEqual(data, readFileSync(new URL('../node_modules/pptxgenjs/' + relative, import.meta.url)), `Installed file differs: ${relative}`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(files.sort(), Object.keys(provenance.files).map((name) => name === 'upstream.package.json' ? 'package.json' : name).sort());
});

test('PPTX generation with internal PNG never loads an image-size parser', () => {
  const probe = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    let parserLoads = 0;
    Module._load = function(id, ...args) {
      if (id === 'image-size' || id.startsWith('image-size/') || id === 'sizeof') {
        parserLoads++;
        throw new Error('Forbidden image parser load');
      }
      return original.call(this, id, ...args);
    };
    const PptxGenJS = require('pptxgenjs');
    const JSZip = require('jszip');
    const fs = require('node:fs');
    (async () => {
      const presentation = new PptxGenJS();
      const slide = presentation.addSlide();
      slide.addText('Informe: solución verificada', {x:1,y:2,w:5,h:1});
      slide.addImage({data:'image/png;base64,'+fs.readFileSync('assets/report/logo.png').toString('base64'),x:1,y:1,w:2,h:1});
      const buffer = await presentation.write({outputType:'nodebuffer'});
      const archive = await JSZip.loadAsync(buffer);
      assert.ok(archive.file('ppt/slides/slide1.xml'));
      assert.ok(Object.keys(archive.files).some(name => name.startsWith('ppt/media/') && name.endsWith('.png')));
      assert.match(await archive.file('ppt/slides/slide1.xml').async('string'), /Informe: solución verificada/);
      assert.equal(parserLoads, 0);
      console.log('PPTX verified; parser loads: 0');
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', probe], {
    cwd: functionsDirectory, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PPTX verified; parser loads: 0/);
});
