// node --test lib/review-chronology.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalCompare, compareArtifactsForRail, compareIssuesWithinArtifact,
  groupIssuesByArtifact, flattenGroupedIssues, groupCountLabel,
  artifactDisplayName, WHOLE_RUN_LABEL,
  type ChronoArtifact, type ChronoIssue,
} from './review-chronology.ts';
import {
  fixtureArtifacts, fixtureIssues, EXPECTED_GROUPS, EXPECTED_TOTAL,
} from './review-multi-file-fixture.ts';

const art = (id: string, relativePath: string, ordinal?: number | null): ChronoArtifact =>
  ({ id, relativePath, ...(ordinal === undefined ? {} : { ordinal }) });

const media = (id: string, artifactId: string | null, startMs: number, endMs: number | null = null): ChronoIssue =>
  ({ id, artifactId, anchor: { type: 'media_time', timeStartMs: startMs, timeEndMs: endMs } });

const names = (gs: ReturnType<typeof groupIssuesByArtifact>) => gs.map((g) => g.displayName);
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

// ── natural filename order ──────────────────────────────────────────────────

test('REPRO: Chapter2 sorts before Chapter10, which lexicographic order gets backwards', () => {
  const files = ['Chapter10.mp4', 'Chapter2.mp4', 'Chapter1.mp4'];
  assert.deepEqual([...files].sort(naturalCompare), ['Chapter1.mp4', 'Chapter2.mp4', 'Chapter10.mp4']);
  // The failure this replaces, stated so the test cannot pass for the wrong reason.
  assert.deepEqual([...files].sort(), ['Chapter1.mp4', 'Chapter10.mp4', 'Chapter2.mp4']);
});

test('natural order is total: distinct names never compare equal', () => {
  const distinct = ['a1.mp4', 'a01.mp4', 'A1.mp4', 'a1.mov', 'a2.mp4', 'a.mp4'];
  for (const x of distinct) {
    for (const y of distinct) {
      if (x === y) assert.equal(naturalCompare(x, y), 0, `${x} vs itself`);
      else assert.notEqual(naturalCompare(x, y), 0, `${x} and ${y} compared equal`);
    }
  }
});

test('natural order is antisymmetric', () => {
  // Normalised rather than Math.sign: Math.sign(0) negated is -0, and strict equality
  // separates -0 from 0, which would fail every self-comparison for no real reason.
  const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
  const files = ['Chapter1.mp4', 'chapter2.mp4', 'Chapter10.mp4', 'intro.mov', 'B.mp4'];
  for (const x of files) {
    for (const y of files) {
      assert.equal(sign(naturalCompare(x, y)), sign(-naturalCompare(y, x)), `${x}/${y}`);
    }
  }
});

test('numeric runs compare by value, not by digit count', () => {
  assert.ok(naturalCompare('shot9.mp4', 'shot10.mp4') < 0);
  assert.ok(naturalCompare('shot099.mp4', 'shot100.mp4') < 0);
});

// ── artifact (group) order ──────────────────────────────────────────────────

test('an explicit backend artifact order wins over filename order', () => {
  const a = art('a', 'Chapter1.mp4', 2);
  const b = art('b', 'Chapter2.mp4', 1);
  assert.ok(compareArtifactsForRail(b, a) < 0, 'ordinal 1 must precede ordinal 2');
  // Without the ordinal, the filenames decide the other way — proving the ordinal
  // is what moved it, not the names.
  assert.ok(compareArtifactsForRail(art('a', 'Chapter1.mp4'), art('b', 'Chapter2.mp4')) < 0);
});

test('artifacts carrying an explicit order precede those without one', () => {
  assert.ok(compareArtifactsForRail(art('b', 'Zzz.mp4', 5), art('a', 'Aaa.mp4')) < 0);
});

test('a non-finite ordinal is ignored rather than trusted', () => {
  const bad = { id: 'a', relativePath: 'Chapter2.mp4', ordinal: Number.NaN } as ChronoArtifact;
  const good = art('b', 'Chapter1.mp4');
  assert.ok(compareArtifactsForRail(good, bad) < 0, 'NaN must not win the comparison');
});

test('duplicate display names stay distinct, ordered by artifact id', () => {
  const x = art('id-a', 'Chapter1.mp4');
  const y = art('id-b', 'Chapter1.mp4');
  assert.ok(compareArtifactsForRail(x, y) < 0);
  assert.ok(compareArtifactsForRail(y, x) > 0);
});

// ── within-file order ───────────────────────────────────────────────────────

test('inside one file: start, then end, then id', () => {
  const list = [
    media('i-c', 'f', 5_000, 9_000),
    media('i-a', 'f', 5_000, 6_000),
    media('i-b', 'f', 1_000),
    media('i-d', 'f', 5_000, 6_000),
  ];
  assert.deepEqual(ids([...list].sort(compareIssuesWithinArtifact)), ['i-b', 'i-a', 'i-d', 'i-c']);
});

test('equal timestamps remain stable regardless of input order', () => {
  const a = media('aaa', 'f', 12_500);
  const b = media('bbb', 'f', 12_500);
  assert.deepEqual(ids([a, b].sort(compareIssuesWithinArtifact)), ['aaa', 'bbb']);
  assert.deepEqual(ids([b, a].sort(compareIssuesWithinArtifact)), ['aaa', 'bbb']);
});

test('a point comment precedes a range opening at the same instant', () => {
  const point = media('p', 'f', 27_000);
  const range = media('r', 'f', 27_000, 31_500);
  assert.ok(compareIssuesWithinArtifact(point, range) < 0);
  // Not merely an id accident: reverse the ids and the rule still holds.
  assert.ok(compareIssuesWithinArtifact(media('z', 'f', 27_000), media('a', 'f', 27_000, 31_500)) < 0);
});

test('mixed anchor kinds never compare a millisecond against a character offset', () => {
  const timed = media('t', 'f', 90_000);
  const text: ChronoIssue = { id: 'x', artifactId: 'f', anchor: { type: 'text_selection', startOffset: 3, endOffset: 9 } };
  const whole: ChronoIssue = { id: 'w', artifactId: 'f', anchor: { type: 'artifact' } };
  assert.deepEqual(ids([whole, text, timed].sort(compareIssuesWithinArtifact)), ['t', 'x', 'w']);
});

// ── grouping ────────────────────────────────────────────────────────────────

test('REPRO: issues are never globally sorted across files', () => {
  const artifacts = [art('c1', 'Chapter1.mp4'), art('c3', 'Chapter3.mp4')];
  const issues = [media('late-ch1', 'c1', 40_000), media('early-ch3', 'c3', 4_000)];
  const flat = flattenGroupedIssues(groupIssuesByArtifact(issues, artifacts));
  assert.deepEqual(ids(flat), ['late-ch1', 'early-ch3'],
    'a 00:04 issue on Chapter3 must stay below a 00:40 issue on Chapter1');
});

test('grouping is by artifact id, so duplicate filenames stay separated', () => {
  const artifacts = [art('id-a', 'Chapter1.mp4'), art('id-b', 'Chapter1.mp4')];
  const issues = [media('one', 'id-a', 1_000), media('two', 'id-b', 2_000)];
  const groups = groupIssuesByArtifact(issues, artifacts);
  assert.equal(groups.length, 2, 'two artifacts sharing a name are two groups');
  assert.deepEqual(groups.map((g) => g.artifactId), ['id-a', 'id-b']);
  assert.deepEqual(groups.map((g) => g.count), [1, 1]);
});

test('whole-run comments group last, under their own heading', () => {
  const artifacts = [art('c1', 'Chapter1.mp4')];
  const issues = [
    { id: 'w', artifactId: null, anchor: { type: 'artifact' } } as ChronoIssue,
    media('a', 'c1', 1_000),
  ];
  const groups = groupIssuesByArtifact(issues, artifacts);
  assert.deepEqual(names(groups), ['Chapter1.mp4', WHOLE_RUN_LABEL]);
  assert.equal(groups[1].artifactId, null);
});

test('an issue naming an artifact the packet lacks keeps its own group, after real files', () => {
  const artifacts = [art('c1', 'Chapter1.mp4')];
  const issues = [media('ghost', 'gone', 1_000), media('real', 'c1', 9_000)];
  const groups = groupIssuesByArtifact(issues, artifacts);
  assert.deepEqual(groups.map((g) => g.artifactId), ['c1', 'gone']);
  assert.equal(groups[1].unavailable, true);
  // It is NOT folded into "whole run": it was written about a file.
  assert.notEqual(groups[1].displayName, WHOLE_RUN_LABEL);
});

test('each group counts exactly the issues it renders', () => {
  const groups = groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  for (const g of groups) assert.equal(g.count, g.issues.length, g.displayName);
});

test('grouping does not mutate its inputs', () => {
  const before = ids(fixtureIssues);
  groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  assert.deepEqual(ids(fixtureIssues), before);
});

// ── the production multi-file fixture ───────────────────────────────────────

test('the 12-issue production session groups Chapter1, then Chapter2, then Chapter3', () => {
  const groups = groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  assert.deepEqual(
    groups.map((g) => ({ displayName: g.displayName, count: g.count })),
    EXPECTED_GROUPS,
  );
  assert.equal(flattenGroupedIssues(groups).length, EXPECTED_TOTAL);
});

test('timestamps sort locally inside each fixture file', () => {
  const groups = groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  for (const g of groups) {
    const starts = g.issues.map((i) => Number((i.anchor as Record<string, unknown>).timeStartMs));
    const sorted = [...starts].sort((a, b) => a - b);
    assert.deepEqual(starts, sorted, `${g.displayName} is not in local time order`);
  }
});

test("the fixture's equal-timestamp pair keeps a deterministic order", () => {
  const groups = groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  const ch1 = groups[0].issues.map((i) => i.id);
  const a = ch1.indexOf('11111111-0000-4000-8000-0000000000a1');
  const b = ch1.indexOf('11111111-0000-4000-8000-0000000000b2');
  assert.ok(a >= 0 && b >= 0);
  assert.ok(a < b, 'the lower id must come first at an identical timestamp');
});

test('the fixture order is independent of input order', () => {
  const forward = flattenGroupedIssues(groupIssuesByArtifact(fixtureIssues, fixtureArtifacts));
  const reversed = flattenGroupedIssues(groupIssuesByArtifact([...fixtureIssues].reverse(), fixtureArtifacts));
  assert.deepEqual(ids(forward), ids(reversed));
});

// ── header copy ─────────────────────────────────────────────────────────────

test('the sticky header pluralises its count', () => {
  assert.equal(groupCountLabel(1), '1 issue');
  assert.equal(groupCountLabel(9), '9 issues');
  assert.equal(groupCountLabel(0), '0 issues');
});

test('an artifact with no path is labelled, never printed blank', () => {
  assert.equal(artifactDisplayName(null), 'Unavailable file');
  assert.equal(artifactDisplayName({ id: 'x', relativePath: '   ' }), 'Unavailable file');
});
