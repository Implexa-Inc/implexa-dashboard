// node --test app/(dashboard)/_components/agents-favorites-search.test.ts
//
// AgentsList is a client component (hooks + DOM), so these pin the favorite +
// search behaviours by source. Each guards a property a refactor could silently
// break.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'agents-list.tsx'), 'utf8');

test('the star toggle is optimistic and reverts on failure (never a blocking error)', () => {
  const fn = SRC.slice(SRC.indexOf('async function toggleFavorite'), SRC.indexOf('async function rename'));
  assert.ok(fn.length > 0, 'toggleFavorite must exist');
  assert.match(fn, /setList\(list\.map\(\(x\) => \(x\.slug === a\.slug \? \{ \.\.\.x, favorite: next \} : x\)\)\)/, 'optimistic flip in place');
  assert.match(fn, /method: next \? 'POST' : 'DELETE'/, 'POST to star, DELETE to un-star');
  assert.match(fn, /\/api\/v2\/me\/workflows\/favorite/, 'hits the favorite endpoint');
  assert.match(fn, /catch \{[\s\S]*?setList\(prev\)/, 'a failed write reverts the star, no error banner');
});

test('favorites float into their own top section and are removed from the lower sections (shown once)', () => {
  assert.match(SRC, /const favorites = shown\.filter\(\(a\) => a\.favorite\)/, 'a favorites group');
  for (const s of ['scheduled', 'on_demand', 'not_activated', 'paused']) {
    assert.match(SRC, new RegExp(`a\\.section === '${s}' && !a\\.favorite`), `the ${s} section excludes favorites`);
  }
  assert.match(SRC, /<Section title="★ Favorites"/, 'the Favorites section is rendered');
});

test('a running FAVORITE still appears in the live spotlight (not hidden by the exclusion)', () => {
  // recentlyActive must be computed from `shown` (incl. favorites), not `activated`
  // (favorites-excluded), or a starred agent that is running vanishes from the pulse.
  const rc = SRC.slice(SRC.indexOf('const recentlyActive ='), SRC.indexOf('const setCat'));
  assert.match(rc, /shown\s*\.filter\(\(a\) => a\.section === 'scheduled' \|\| a\.section === 'on_demand'\)/,
    'the spotlight includes favorites by filtering `shown`, not the favorites-excluded roster');
});

test('search filters the roster client-side by name or category', () => {
  assert.match(SRC, /a\.name\.toLowerCase\(\)\.includes\(q\) \|\| a\.category\.label\.toLowerCase\(\)\.includes\(q\)/,
    'query matches name or category label');
  assert.match(SRC, /placeholder="Search agents…"/, 'the search input is rendered');
  assert.match(SRC, /No agents match your search/, 'an empty-search state exists');
});
