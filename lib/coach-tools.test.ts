// Tests for lib/coach-tools.ts: tool tags on /coach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS_BY_CATEGORY, joinTools, splitTools, toolsFor } from './coach-tools.ts';

test('tags follow the chosen categories without repeats', () => {
  assert.deepEqual(toolsFor([]), []);
  const both = toolsFor(['marketing', 'design']);
  assert.equal(both.filter((t) => t === 'Canva').length, 1);
  assert.ok(both.includes('Google Ads') && both.includes('Figma'));
});

test('picked tags and free text round-trip through the stored string', () => {
  const stored = joinTools(['Higgsfield', 'Meta Ads (Facebook, Instagram)'], ' Blender, Unreal ');
  assert.equal(stored, 'Higgsfield, Meta Ads (Facebook, Instagram), Blender, Unreal');
  assert.deepEqual(splitTools(stored), {
    picked: ['Higgsfield', 'Meta Ads (Facebook, Instagram)'],
    other: 'Blender, Unreal',
  });
  assert.deepEqual(splitTools(null), { picked: [], other: '' });
});

test('every category id has a tool list', () => {
  assert.deepEqual(Object.keys(TOOLS_BY_CATEGORY),
    ['video', 'marketing', 'design', 'writing', 'development', 'sales', 'research', 'other']);
});
