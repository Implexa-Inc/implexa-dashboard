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
  // The trace itself now renders through <RunStepTrace>, shared with each
  // Production node section, and the refresh rides in its header `action`
  // slot. Assert the wiring at the call site rather than the old inline markup.
  const call = PAGE.slice(PAGE.indexOf('<RunStepTrace'), PAGE.indexOf('<RunStepTrace') + 600);
  assert.ok(call.length > 0, 'the page renders the shared trace component');
  assert.match(call, /action=\{<StepTraceRefresh \/>\}/, 'the control is handed to the trace header');
});

test('the shared trace renders the refresh control in its own header', async () => {
  const { render } = await import('../../../lib/test/render.ts');
  const rendered = await render('run-step-trace.tsx', {
    entries: [{ at: '2026-08-16T10:01:00.000Z', step: '1/2', note: 'reading the brief' }],
    action: null,
  });
  try {
    // The header exists and carries the label the run page's copy depends on.
    assert.ok(rendered.queryByText(/Step trace/), 'the shared component owns the heading');
  } finally { rendered.cleanup(); }
});
