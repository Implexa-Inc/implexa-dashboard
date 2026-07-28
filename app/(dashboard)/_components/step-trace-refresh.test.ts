// node --test app/(dashboard)/_components/step-trace-refresh.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CMP = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'step-trace-refresh.tsx'), 'utf8');
const PAGE = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');

test('the refresh control re-fetches the server component (router.refresh) inside a transition', () => {
  assert.match(CMP, /'use client'/, 'must be a client component to have an onClick');
  assert.match(CMP, /router\.refresh\(\)/, 'refresh re-runs the server render, repainting the trace');
  assert.match(CMP, /useTransition/, 'wrapped in a transition so it can show a pending/spin state');
  assert.match(CMP, /animate-spin/, 'the icon spins while refetching');
  assert.match(CMP, /'Refresh'/, 'the control has a visible label, not an icon-only hit target');
  assert.doesNotMatch(CMP, /ml-auto/, 'refresh stays beside the trace status instead of being stranded at the far edge');
});

test('the Step trace header renders the refresh control', () => {
  assert.match(PAGE, /import StepTraceRefresh from/, 'the page imports it');
  // it sits in the same header block as the "Step trace" label + live badge
  const header = PAGE.slice(PAGE.indexOf('>Step trace<'), PAGE.indexOf('>Step trace<') + 500);
  assert.match(header, /<StepTraceRefresh \/>/, 'the control is rendered in the Step trace header');
});
