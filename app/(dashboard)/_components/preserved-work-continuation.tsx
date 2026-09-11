'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import { runRequestRefusalCopy } from '@/lib/run-request-refusal';
import { useSetupRequiredGate } from './setup-required-gate';

// This instruction is server-visible recovery intent, not a claim that any work
// completed. The managed continuation must verify the prior run's preserved
// artifacts before reusing them and must resume at the first unfinished step.
export const PRESERVED_WORK_CONTINUATION_NOTE = [
  'Continue this exact run from its Desktop-validated preserved work.',
  'Verify and reuse every completed artifact and completed step; do not repeat paid provider calls, dependency installation, or other completed production work.',
  'Resume at the first pending step, then finish normal artifact settlement, QA, Judge, and Manager proof.',
].join(' ');

export default function PreservedWorkContinuation({ runId, slug = null, workflowVersionId = null }: {
  runId: string;
  /** The run's agent and FROZEN version, for "Open setup" on a setup refusal. */
  slug?: string | null;
  workflowVersionId?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MACHINE-CAPABILITY ADMISSION (backend 0346): a managed continuation re-runs
  // admission for the run's frozen version. Its typed setup_required refusal is
  // the shared modal — never this surface's error line, never a navigation.
  const setupGate = useSetupRequiredGate({ slug, workflowVersionId });

  async function queue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const gated = await setupGate.guard(({ machineId }) => callBackend('/api/v2/me/run-requests', {
        jwt: session?.access_token,
        method: 'POST',
        body: {
          kind: 'continue',
          runId,
          note: PRESERVED_WORK_CONTINUATION_NOTE,
          source: 'dashboard',
          ...(machineId ? { executionMachineId: machineId } : {}),
        },
      }), () => {
        // A managed continuation is drained hands-off. Show its queued/running row,
        // rather than leaving the user on the failed parent with a dead spinner.
        router.push('/workflows');
        router.refresh();
      });
      if (!gated.ok) { setBusy(false); return; }
    } catch (cause) {
      setError(runRequestRefusalCopy(cause, 'Could not continue the preserved work. Try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={queue}
        disabled={busy}
        className="btn-success text-sm px-4 py-2 disabled:opacity-60"
      >
        {busy ? 'Queuing continuation…' : 'Continue preserved work'}
      </button>
      <p className="mt-2 text-xs text-ink-400 leading-relaxed">
        Starts a managed continuation with the same frozen inputs. It verifies and reuses completed work, then resumes at the first unfinished step.
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {setupGate.modal}
    </div>
  );
}
