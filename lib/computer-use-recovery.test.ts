// node --test lib/computer-use-recovery.test.ts
//
// Computer Use repair affordances. The desktop IPC is Desktop A's to ship; this
// surface must feature-detect it and degrade honestly. A button that looks live and
// silently no-ops is worse than one that says the app needs updating — the user would
// conclude the restart FAILED rather than that it never ran.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recoverySupported, recoveryActions, runRecovery, recoverySummary, UPDATE_REQUIRED,
} from './computer-use-recovery.ts';

test('support is detected on the IPC FUNCTIONS, not the bridge object', () => {
  assert.equal(recoverySupported({}), false);
  // an old build can expose the bridge with none of these methods
  assert.equal(recoverySupported({ implexaDesktop: {} }), false);
  assert.equal(recoverySupported({ implexaDesktop: { computerUseRestart: () => {} } }), true);
  assert.equal(recoverySupported({ implexaDesktop: { computerUseCheck: () => {} } }), true);
});

test('REPRO: an old desktop shows the update message instead of a dead button', () => {
  const actions = recoveryActions('helper_unhealthy', { inDesktop: true, supported: false });
  const restart = actions.find((a) => a.kind === 'restart_control')!;
  assert.equal(restart.enabled, false);
  assert.equal(restart.disabledReason, UPDATE_REQUIRED);
  assert.match(restart.disabledReason!, /Update Implexa/i);
});

test('an ordinary browser is told repair needs the desktop app', () => {
  const actions = recoveryActions('permission_missing', { inDesktop: false, supported: false });
  const perms = actions.find((a) => a.kind === 'open_permissions')!;
  assert.equal(perms.enabled, false);
  assert.match(perms.disabledReason!, /desktop app/i);
});

test('the primary action follows the cause, and is listed first', () => {
  const opts = { inDesktop: true, supported: true };
  assert.equal(recoveryActions('helper_unhealthy', opts)[0].kind, 'restart_control');
  assert.equal(recoveryActions('permission_missing', opts)[0].kind, 'open_permissions');
  assert.equal(
    recoveryActions('target_app_unavailable', { ...opts, alternateEngineReady: true })[0].kind,
    'try_another_engine',
  );
});

test('Try another engine survives an un-upgradable desktop — it is routing, not repair', () => {
  // The asymmetry is the point: the user keeps a way forward even when local repair
  // is unavailable.
  const old = recoveryActions('helper_unhealthy', { inDesktop: true, supported: false, alternateEngineReady: true });
  const alt = old.find((a) => a.kind === 'try_another_engine')!;
  assert.equal(alt.enabled, true);
  assert.equal(alt.disabledReason, null);
});

test('Try another engine is disabled with a reason when no alternate is ready', () => {
  const a = recoveryActions('helper_unhealthy', { inDesktop: true, supported: true, alternateEngineReady: false })
    .find((x) => x.kind === 'try_another_engine')!;
  assert.equal(a.enabled, false);
  assert.match(a.disabledReason!, /No other engine is ready/i);
});

test('unsupported and failed are DIFFERENT results — they imply different remedies', () => {
  return Promise.all([
    runRecovery('restart_control', {}).then((r) => {
      assert.equal(r.status, 'unsupported', 'no bridge at all -> update the app');
    }),
    runRecovery('restart_control', { implexaDesktop: { computerUseRestart: async () => ({ ok: false, error: 'helper busy' }) } })
      .then((r) => {
        assert.equal(r.status, 'failed', 'we asked and it refused -> a different remedy');
        assert.match((r as { error: string }).error, /helper busy/);
      }),
    runRecovery('restart_control', { implexaDesktop: { computerUseRestart: async () => { throw new Error('ipc crashed'); } } })
      .then((r) => {
        assert.equal(r.status, 'failed');
        assert.match((r as { error: string }).error, /ipc crashed/);
      }),
    runRecovery('restart_control', { implexaDesktop: { computerUseRestart: async () => ({ ok: true }) } })
      .then((r) => assert.equal(r.status, 'ok')),
  ]);
});

test('the summary collapses technical detail and never sends the user off to download something', () => {
  for (const cause of ['helper_unhealthy', 'permission_missing', 'target_app_unavailable', 'unknown'] as const) {
    const s = recoverySummary(cause);
    assert.ok(s.length > 0);
    assert.doesNotMatch(s, /download|installer|\.dmg|repair the/i,
      'never tell the user to fetch an external artifact when no provider job was submitted');
  }
});
