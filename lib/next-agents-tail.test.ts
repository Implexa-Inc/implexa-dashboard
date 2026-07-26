// node --test app/(dashboard)/_components/run-markdown-strip.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripNextAgentsTail } from './next-agents-tail.ts';

const TAIL = `## Next agents to build
1. **remotion-overlay-youtube-uploader** — publish the MP4. *(on demand)*
2. **remotion-overlay-qa-frame-reviewer** — catch drift. *(on demand)*`;

test('strips the delivery-only "Next agents to build" tail so only the deliverable renders', () => {
  const md = `# Reel shipped\n\nHere is the result.\n\n${TAIL}\n`;
  const out = stripNextAgentsTail(md);
  assert.match(out, /Reel shipped/);
  assert.match(out, /Here is the result/);
  assert.doesNotMatch(out, /Next agents to build/, 'the tail (rendered as button-less prose) is gone');
  assert.doesNotMatch(out, /youtube-uploader/);
});

test('handles the tail as the entire content (empty deliverable → empty render)', () => {
  assert.equal(stripNextAgentsTail(TAIL).trim(), '');
});

test('does NOT strip when there is no such tail', () => {
  const md = '# Done\n\nAll good, nothing recommended.\n';
  assert.equal(stripNextAgentsTail(md), md);
});

test('a deliverable that MENTIONS the phrase earlier keeps everything up to the real tail', () => {
  // Only the LAST heading (the appended tail) is the cut point; earlier prose survives.
  const md = `## Plan\nWe considered the "Next agents to build" idea.\n\nDelivered.\n\n${TAIL}\n`;
  const out = stripNextAgentsTail(md);
  assert.match(out, /We considered the "Next agents to build" idea/, 'inline mention in prose is kept');
  assert.match(out, /Delivered\./);
  assert.doesNotMatch(out, /youtube-uploader/, 'but the actual appended tail is removed');
});

test('is safe on empty / nullish input', () => {
  assert.equal(stripNextAgentsTail(''), '');
  // @ts-expect-error — runtime guard for a null slipping through
  assert.equal(stripNextAgentsTail(null), '');
});
