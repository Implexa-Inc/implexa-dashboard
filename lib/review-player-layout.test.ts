// node --test lib/review-player-layout.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url)),
  'utf8',
);

test('the inline Review video stays viewport-bounded while preserving its aspect ratio', () => {
  assert.match(source, /max-h-\[60vh\][^']*object-contain/);
});

