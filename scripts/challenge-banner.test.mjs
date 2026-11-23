import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

test('both challenge banners preserve full text and wrap long words', () => {
  const source = readFileSync(new URL('../src/PlayerApp.tsx', import.meta.url), 'utf8');
  const banner = source.split('{/* Challenge Banner */}')[1].split('{/* Main Content */}')[0];
  const paragraphs = [...banner.matchAll(/<p className="([^"]+)">/g)];
  assert.equal(paragraphs.length, 2);
  for (const [, classes] of paragraphs) {
    assert.doesNotMatch(classes, /line-clamp|truncate|overflow-hidden/);
    assert.match(classes, /whitespace-pre-wrap/);
    assert.match(classes, /\[overflow-wrap:anywhere\]/);
  }
});
