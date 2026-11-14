'use client';

import { useEffect, useState } from 'react';
import {
  getScheduleReadinessBridge,
  type ScheduleReadinessStatus,
} from '@/lib/schedule-readiness';

type ViewState = ScheduleReadinessStatus | { status: 'loading' | 'web' };

export default function ScheduleReadinessCard() {
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [checking, setChecking] = useState(false);

  async function check() {
    const bridge = getScheduleReadinessBridge();
    if (!bridge?.scheduleReadinessStatus) {
      setState({ status: 'web' });
      return;
    }
    setChecking(true);
    try {
      setState(await bridge.scheduleReadinessStatus());
    } catch {
      setState({
        status: 'unsupported',
        reason: 'read_failed',
        summary: 'Implexa could not check this Mac’s scheduled-agent power setting.',
      });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => { void check(); }, []);

  if (state.status === 'loading' || state.status === 'web') return null;

  const ready = state.status === 'ready';
  const actionable = state.status === 'action_required';

  async function openSettings() {
    const bridge = getScheduleReadinessBridge();
    if (!bridge?.openSchedulePowerSettings) return;
    await bridge.openSchedulePowerSettings().catch(() => null);
  }

  return (
    <section className={`mb-6 rounded-xl border p-4 ${
      ready
        ? 'border-emerald-500/35 bg-emerald-500/[0.06]'
        : actionable
          ? 'border-amber-500/45 bg-amber-500/[0.07]'
          : 'border-ink-700 bg-ink-900/40'
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="min-w-0">
          <div className={`text-sm font-medium ${
            ready ? 'text-emerald-500' : actionable ? 'text-amber-400' : 'text-ink-200'
          }`}>
            {ready ? '✓ This Mac is ready for scheduled agents' : actionable ? '⚠ Keep this Mac ready for schedules' : 'Schedule power readiness unavailable'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">
            {'summary' in state && state.summary
              ? state.summary
              : 'Implexa could not inspect the Mac’s power-adapter sleep setting.'}
          </p>
          {actionable && (
            <p className="mt-1 text-xs text-ink-400">
              Keep it plugged in and prevent system sleep on power. The display can still turn off and lock normally.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {actionable && (
            <button type="button" onClick={openSettings} className="btn-primary text-xs px-3 py-1.5">
              Open Mac settings
            </button>
          )}
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="text-xs px-3 py-1.5 rounded-md border border-ink-700 text-ink-300 hover:text-ink-100 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </section>
  );
}
