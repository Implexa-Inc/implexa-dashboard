import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BackendError } from './api.ts';
import { runRequestRefusalCopy } from './run-request-refusal.ts';

test('Review Room retry refusals retain their distinct recovery meaning', () => {
  const cases = [
    ['review_continuation_still_running', 'still running or shutting down'],
    ['review_continuation_live_state_unknown', 'cannot safely verify'],
    ['review_continuation_not_terminal', 'safe retry state'],
    ['review_continuation_cancelled', 'cancelled'],
    ['review_submission_already_reported', 'already finished'],
    ['review_retry_schema_unavailable', 'temporarily unavailable'],
  ];
  for (const [reason, phrase] of cases) {
    const error = new BackendError(reason, 400, { ok: false, reason });
    assert.match(runRequestRefusalCopy(error, 'fallback'), new RegExp(phrase, 'i'));
  }
});

test('unknown or non-backend failures use the caller-owned safe fallback', () => {
  assert.equal(runRequestRefusalCopy(new Error('private transport detail'), 'Try again.'), 'Try again.');
  assert.equal(
    runRequestRefusalCopy(new BackendError('some_new_reason', 500, { reason: 'some_new_reason' }), 'Try again.'),
    'Try again.',
  );
});

test('both continuation surfaces render the typed refusal instead of a generic catch', () => {
  const root = path.resolve(import.meta.dirname, '..');
  for (const file of ['run-actions.tsx', 'run-continue-box.tsx']) {
    const source = fs.readFileSync(path.join(root, 'app', '(dashboard)', '_components', file), 'utf8');
    assert.match(source, /import \{ runRequestRefusalCopy \} from '@\/lib\/run-request-refusal';/);
    assert.match(source, /set(?:Err|Msg)\(runRequestRefusalCopy\((?:error|e), 'Could not queue/);
  }
});
