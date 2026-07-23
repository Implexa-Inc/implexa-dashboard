'use client';

/**
 * <PlanReviewModal /> — the "Here's the plan — change anything?" step shown
 * BEFORE a new agent is persisted (2026-07-23). Every dashboard Create surface
 * routes through this: the user sees the capabilities, the recommended tool per
 * capability, viable alternatives, access route + cost, and can accept in one
 * click OR change any single tool. Only on acceptance is the build enqueued,
 * carrying the confirmed toolPreferences.
 *
 * The dashboard NEVER chooses vendors itself. A tool change just records the
 * user's preference and RE-ASKS the backend, which resolves it into the real
 * stack (picking Veed for the avatar also moves assembly to Veed, because Veed
 * serves both — and leaves Runway on b-roll). The returned plan is the source of
 * truth for what's rendered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPlanPreview, createAgentBuild, preferenceFor,
  type AgentPlan, type PlanCapability, type ToolChoice,
} from '@/lib/plan-review';

const REQUIREDNESS_LABEL: Record<PlanCapability['requiredness'], string> = {
  required_to_deliver: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

function optionsFor(cap: PlanCapability): ToolChoice[] {
  // Every tool that can serve this capability: the current pick + alternatives.
  const out: ToolChoice[] = [];
  if (cap.recommendedTool) out.push(cap.recommendedTool);
  for (const a of cap.alternatives) if (!out.some((o) => o.id === a.id)) out.push(a);
  return out;
}

// The OTHER capability labels this capability's selected tool ALSO fills. The
// backend treats a tool preference as cross-capability (choosing Veed for the
// avatar also moves final assembly to Veed), so the row must say so — otherwise
// a change silently affects a capability the user didn't touch.
function alsoHandledLabels(caps: PlanCapability[], cap: PlanCapability): string[] {
  if (!cap.selectedToolId) return [];
  return caps
    .filter((c) => c.id !== cap.id && c.selectedToolId === cap.selectedToolId)
    .map((c) => c.label);
}

export default function PlanReviewModal({
  intent, mode, cron, timezone, onCancel, onCreated,
}: {
  intent: string;
  mode?: string;
  cron?: string;
  timezone?: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The user's explicit per-capability picks (toolId -> its label). Preferences
  // sent to the server are derived from these; the server resolves them.
  const [chosen, setChosen] = useState<Record<string, ToolChoice>>({});
  const reqId = useRef(0);

  const toolPreferences = Array.from(
    new Map(Object.values(chosen).map((t) => [t.id, preferenceFor(t.label)])).values(),
  );

  const load = useCallback(async (prefs: string[]) => {
    const mine = ++reqId.current;
    setError(null);
    try {
      const p = await fetchPlanPreview(intent, prefs, []);
      if (mine === reqId.current) setPlan(p); // ignore a stale in-flight response
    } catch (e) {
      if (mine === reqId.current) setError(e instanceof Error ? e.message : 'could not build the plan');
    }
  }, [intent]);

  // (Re)load whenever the chosen preferences change.
  useEffect(() => { load(toolPreferences); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, JSON.stringify(toolPreferences)]);

  function changeTool(capId: string, tool: ToolChoice) {
    setChosen((c) => ({ ...c, [capId]: tool }));
  }
  function resetToRecommended() { setChosen({}); }

  async function create() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const res = await createAgentBuild({ intent, toolPreferences, mode, cron, timezone });
    setCreating(false);
    if (!res.ok) { setError(res.error || 'enqueue failed'); return; }
    onCreated();
  }

  const hasChanges = Object.keys(chosen).length > 0;
  const hasGap = !!plan && plan.capabilities.some((c) => c.unresolved);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Review the agent plan">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-ink-800 bg-ink-950 p-6 shadow-2xl">
        {/* "Suggested setup" until the user actually changes a tool — these are
            deterministic defaults, not choices a model deliberated over, so the
            heading must not overclaim (2026-07-23 fix spec). */}
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{hasChanges ? 'Your plan' : 'Suggested setup'}</div>
        <h2 className="text-lg font-semibold text-ink-100">{plan?.proposedName || 'Your new agent'}</h2>
        <p className="mt-1 text-sm text-ink-400 leading-snug">
          Review the tools this agent will use. Accept the recommended setup in one click, or change any tool.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="mt-6 text-sm text-ink-500">Composing the plan…</div>
        )}

        {plan && (
          <>
            <ul className="mt-4 divide-y divide-ink-800 rounded-lg border border-ink-800">
              {plan.capabilities.length === 0 && (
                <li className="px-3 py-3 text-sm text-ink-400">
                  This agent works with text only — no external tools to choose. It’s ready to build.
                </li>
              )}
              {plan.capabilities.map((cap) => {
                const options = optionsFor(cap);
                return (
                  <li key={cap.id} className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-ink-100">{cap.label}</span>
                          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                            cap.requiredness === 'required_to_deliver'
                              ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                              : 'border-ink-700 text-ink-400'
                          }`}>{REQUIREDNESS_LABEL[cap.requiredness]}</span>
                        </div>
                        <p className="text-xs text-ink-500 mt-0.5 leading-snug">{cap.purpose}</p>
                        {cap.unresolved ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 leading-snug">
                            No tool available: {cap.unresolved.reason}
                          </p>
                        ) : cap.recommendedTool ? (
                          <p className="text-xs text-ink-500 mt-1">
                            {cap.recommendedTool.accessModeLabel}
                            {cap.recommendedTool.costNote ? ` · ${cap.recommendedTool.costNote}` : ''}
                          </p>
                        ) : null}
                        {(() => {
                          const also = alsoHandledLabels(plan.capabilities, cap);
                          return also.length ? (
                            <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-1 leading-snug">
                              {cap.recommendedTool?.label ?? 'This tool'} also handles {also.join(' and ')}.
                            </p>
                          ) : null;
                        })()}
                      </div>
                      <div className="flex-none">
                        {options.length > 0 ? (
                          <select
                            aria-label={`Tool for ${cap.label}`}
                            className="text-xs rounded-md border border-ink-700 bg-ink-900 text-ink-100 px-2 py-1"
                            value={cap.selectedToolId || ''}
                            onChange={(e) => {
                              const t = options.find((o) => o.id === e.target.value);
                              if (t) changeTool(cap.id, t);
                            }}
                          >
                            {!cap.selectedToolId && <option value="">Choose a tool…</option>}
                            {options.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">no tool</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {hasGap && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                A required capability has no available tool. You can still create the agent — it will flag the gap instead of substituting a different tool.
              </p>
            )}
            {plan.unresolvedOverrides.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                Couldn’t recognize: {plan.unresolvedOverrides.join(', ')}. Using the recommended tools for those.
              </p>
            )}

            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={create}
                disabled={creating}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {creating ? 'Creating…' : hasChanges ? 'Create this agent' : 'Create with recommended plan'}
              </button>
              {hasChanges && (
                <button type="button" onClick={resetToRecommended} disabled={creating} className="btn-outline text-sm px-3 py-2">
                  Reset to recommended
                </button>
              )}
              <button type="button" onClick={onCancel} disabled={creating} className="text-sm text-ink-400 hover:text-ink-200 px-2 py-2">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
