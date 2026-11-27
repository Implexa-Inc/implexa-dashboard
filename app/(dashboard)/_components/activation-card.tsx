'use client';

/**
 * <ActivationCard /> — the guided activation todo-list (ACTIVATION_JOURNEY.md).
 * One card, one row per step, one CTA per row. Steps the agent doesn't need are
 * already marked done/auto by the backend, so the user only ever sees what's
 * left. Plain language only (no "Bash" / "mcp__…"). Tier-2 permissions are the
 * one place we ask for a deliberate opt-in.
 *
 * Phase 3: renders the checklist + wires the link CTAs (Connections, Schedule)
 * and the local toggles (notifications, Tier-2 opt-in). The final POST /activate
 * lands next; the Activate button reflects readiness today.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ProviderBrowserSignIn, usesProviderBrowserSession } from './provider-browser-sign-in';
import { mapActivationChecklist } from '@/lib/activation-core';
import { commandApprovalAccountMatches, saveAgentCommandApproval } from '@/lib/agent-command-approval';
import { callBackend } from '@/lib/api';
import AgentActions from './agent-actions';
import AgentSetupCard from './agent-setup-card';
import { ActivationRequirements, DeclaredMachineTools } from './activation-requirements';
import { MarketplaceExecutionRequirementsCard } from './marketplace-execution-requirements';
import CapabilityGapsNotice from './capability-gaps-notice';
import AgentFeedback from './agent-feedback';
import AgentBrowserConnect from './agent-browser-connect';
import ManagedBrowserOwnerDeclaration from './managed-browser-owner-declaration';
import { ImplexaJudgePolicy } from './implexa-judge-policy';
import { useDesktopBridge, desktopBridge, KeysList, type KeyItem } from './api-key-row';
import type { ActivationChecklist, ActivationStep, PermissionItem, PermissionTier, AgentSetupTarget, AgentMacAccess } from '@/lib/activation';
import type { WorkflowRunInputs } from '@/lib/workflow-catalog';

// Defined here (not imported) because lib/activation.ts is server-only; a client
// component can take its TYPES (erased at compile) but not its runtime values.
const TIER_PRESENTATION: Record<PermissionTier, { label: string; classes: string }> = {
  0: { label: 'Auto',      classes: 'border-ink-700 text-ink-400' },
  1: { label: 'Heads-up',  classes: 'border-sky-500/40 text-state-running' },
  2: { label: 'Your call', classes: 'border-amber-500/50 text-state-needs' },
};

function StatusDot({ status }: { status: ActivationStep['status'] }) {
  if (status === 'done' || status === 'auto') {
    return (
      <span className="flex-none mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-state-ok text-secondary">
        ✓
      </span>
    );
  }
  return <span className="flex-none mt-0.5 inline-flex w-5 h-5 rounded-full border-2 border-ink-600" aria-hidden />;
}

function PermissionList({ items, optIns, onToggle, savingGroup, isActive }: {
  items: PermissionItem[];
  optIns: Record<string, boolean>;
  onToggle: (group: string, on: boolean) => void;
  savingGroup?: string | null;
  isActive: boolean;
}) {
  return (
    <ul className="mt-3 space-y-2 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      {items.map((it) => {
        const inherited = it.group === 'shell' && it.granted === true && it.grantScope === 'account_until_revoked';
        const reusable = it.reusableCommandApproval && !it.commandApprovalDisabledForAgent;
        const allowed = it.reusableCommandApproval ? it.granted === true : !!optIns[it.group];
        const spec = TIER_PRESENTATION[inherited ? 0 : it.tier];
        const isOptIn = it.tier === 2;
        const required = isOptIn && !it.optional;
        return (
          <li
            key={it.group}
            data-permission-group={it.group}
            className={`flex items-start justify-between gap-3 rounded-md p-2 ${required && !allowed ? 'border border-amber-500/35 bg-amber-500/5' : ''}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-secondary text-ink-100">{it.label}</span>
                <span className={`text-secondary uppercase tracking-wide px-1.5 py-0.5 rounded border ${spec.classes}`}>
                  {inherited ? spec.label : required ? 'Required' : it.optional ? 'Optional' : spec.label}
                </span>
                {it.optional && <span className="text-secondary text-ink-500">{it.group === 'send' ? 'autopost only' : 'optional'}</span>}
              </div>
              {it.detail && <p className="text-secondary text-ink-500 mt-0.5 leading-snug">{it.detail}</p>}
              {inherited ? (
                <p className="text-secondary text-ink-500 mt-1">
                  Allowed for your account. <a className="underline" href="/settings/run-environment#agent-commands">Manage permission</a>
                </p>
              ) : required && (
                <p className="text-reading text-state-needs mt-1 ">
                  {reusable && !allowed
                    ? 'Allow this once to let your Tukido agents run commands when they need to.'
                    : 'Grant once to this agent. It stays available for its future runs until you revoke it.'}
                </p>
              )}
            </div>
            {isOptIn && (!inherited || isActive) ? (
              <button
                type="button"
                data-permission-action={it.group}
                disabled={savingGroup === it.group}
                onClick={() => onToggle(it.group, !allowed)}
                className={`flex-none text-ui font-medium rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 ${
                  allowed && !inherited
                    ? 'bg-amber-500/20 text-state-needs'
                    : 'border border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >
                {savingGroup === it.group ? 'Saving…'
                  : inherited ? 'Turn off for this agent'
                  : allowed ? 'Allowed for this agent'
                  : reusable ? 'Allow commands for my agents' : required ? 'Allow for this agent' : 'Allow'}
              </button>
            ) : (
              <span className="flex-none text-secondary text-state-ok mt-1">granted</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Just-in-time connections + tools (the activation-phase move) ─────────────
// The desktop shell's bridge (dashboard-preload.js). Present only inside the
// Implexa app; the web falls back to guidance copy. Sign-ins and CLI tool
// installs happen HERE, per agent, for exactly what this agent needs — not as
// an onboarding wall of every account the user may never use.
//
// DesktopBridge / desktopBridge / useDesktopBridge moved to ./api-key-row
// (2026-07-18) so the requirements panel (activation-requirements.tsx) can
// reuse the exact same bridge + key-vault UI instead of a second copy.

type NeededConnection = { account?: string; label?: string; status?: string; identity?: string | null; registeredRead?: boolean };

function ConnectionRow({ item, onChanged, onBrowserVerified, confirmed, onConfirmationChanged, workedAround, onToggleWorkAround, slug }: {
  item: NeededConnection;
  onChanged: () => void;
  onBrowserVerified: () => Promise<void>;
  confirmed: boolean;
  onConfirmationChanged: (confirmed: boolean) => void;
  /** User chose "let Claude figure out an alternative" for this connection. */
  workedAround: boolean;
  onToggleWorkAround: (on: boolean) => void;
  /** Agent slug — for the permanent "remove this requirement" waive. */
  slug: string;
}) {
  const bridge = useDesktopBridge();
  const supabase = createClient();
  const domain = item.account || '';
  const needsSessionCheck = usesProviderBrowserSession(domain);
  const reachable = needsSessionCheck ? confirmed : item.status === 'reachable';
  const [waiving, setWaiving] = useState(false);
  const [waiveNote, setWaiveNote] = useState<string | null>(null);

  // Slice 3: permanently drop a misclassified connection from the agent (owner-only
  // server-side). On success the requirement is gone for good → the checklist
  // refreshes and this row disappears.
  async function removePermanently() {
    if (waiving) return;
    setWaiving(true); setWaiveNote(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/connections/waive`, {
        jwt: session?.access_token, method: 'POST', body: { account: domain || item.label || '' },
      });
      if (res?.ok) onChanged();
      else setWaiveNote(res?.code === 'not_owned'
        ? "This is a shared agent — use the checkbox above instead."
        : 'Could not remove it. Try again.');
    } catch { setWaiveNote('Could not remove it. Try again.'); }
    finally { setWaiving(false); }
  }
  if (item.registeredRead) return <li className="text-secondary text-ink-400">
    Report access for {domain} is checked during each run.
  </li>;
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-secondary text-ink-100">{item.label || domain}</span>
            {workedAround && !reachable && <span className="text-secondary text-state-ok">Claude will work around it</span>}
            {!needsSessionCheck && reachable && <span className="text-secondary text-state-ok">connected{item.identity ? ` as ${item.identity}` : ''}</span>}
          </div>
        </div>
        {(needsSessionCheck || !reachable) && bridge?.connectAccount && (
          <ProviderBrowserSignIn key={domain} domain={domain} onConfirmationChanged={onConfirmationChanged} onVerified={onBrowserVerified} />
        )}
      </div>
      {/* The escape hatch — when you don't have the sign-in, let Claude route around
          it. Ticking this satisfies the connection so "Turn it on" goes green. */}
      {!reachable && (
        <label className="mt-1.5 flex items-start gap-2 text-ui text-ink-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={workedAround}
            onChange={(e) => onToggleWorkAround(e.target.checked)}
            className="accent-brand-500 h-3.5 w-3.5 mt-0.5"
          />
          <span>
            Don&apos;t have access? <span className="text-ink-100">Let Claude figure out an alternative</span>
            <span className="block text-secondary text-ink-500">It&apos;ll try another way (read the public site, web search) and only ask if it truly can&apos;t.</span>
          </span>
        </label>
      )}
      {/* Slice 3: the dep is just wrong (a public source mistaken for a sign-in) →
          remove it from the agent for good. Owner-only; shared agents get a hint. */}
      {!reachable && (
        <div className="mt-1">
          <button
            type="button"
            onClick={removePermanently}
            disabled={waiving}
            className="text-ui text-ink-500 hover:text-ink-200 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {waiving ? 'Removing…' : 'This isn’t a sign-in this agent needs — remove it'}
          </button>
          {waiveNote && <p className="text-reading text-state-needs mt-0.5">{waiveNote}</p>}
        </div>
      )}
    </li>
  );
}

// One passive read of effective product consent + live/observed OS access.
// Opening the local setup window is the only action; this web page cannot grant.
function AgentMacSetup({ target, onReady }: { target: AgentSetupTarget | null; onReady: (ready: boolean) => void }) {
  const bridge = useDesktopBridge();
  const [state, setState] = useState<AgentMacAccess | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkIndex, setCheckIndex] = useState(0);
  const key = target ? JSON.stringify(target) : null;
  useEffect(() => {
    let current = true;
    let sequence = 0;
    const check = async () => {
      const ticket = ++sequence;
      onReady(false);
      setState(null);
      let next: AgentMacAccess = { ok: false, reason: target ? 'setup_unavailable' : 'setup_context_missing' };
      try { if (target && bridge?.agentSetupReadiness) next = await bridge.agentSetupReadiness(target); } catch { /* unavailable */ }
      if (!current || sequence !== ticket) return;
      setState(next);
      onReady(next.ok === true && next.routeResolved === true && next.permissionsReady === true);
    };
    void check();
    window.addEventListener('focus', check);
    return () => { current = false; window.removeEventListener('focus', check); };
  }, [key, bridge, onReady, checkIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = state?.ok && state.routeResolved && state.permissionsReady;
  const unavailable = state?.ok === false || state?.routeResolved === false;
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-3">
    <div>
      <p className="text-reading text-ink-200">{ready ? '✓ Mac access ready' : unavailable ? 'Mac access not verified' : state ? 'Mac access needs setup' : 'Checking Mac access…'}</p>
      {state?.ok && !ready && <p className="mt-1 text-secondary text-ink-400">{state.routeResolved === false ? 'The browser route is checked before execution. Saved browser access can be reviewed here.' : 'Review only the missing permissions in Set Up.'}</p>}
      {state?.ok === false && <p className="mt-1 text-secondary text-ink-400">{state.reason === 'setup_context_missing' ? 'Install or update this Agent, then refresh. If it is already installed, setup is waiting for the matching service update.' : state.reason === 'account_mismatch' ? 'Sign in to the same account in Desktop and this page.' : state.reason === 'agent_setup_changed' ? 'This Agent was updated. Refresh the page and reopen Set Up.' : 'Could not check this Mac. Reconnect Desktop and try again.'}</p>}
      {error && <p role="alert" className="mt-1 text-secondary text-state-needs">{error}</p>}
    </div>
    <div className="flex items-center gap-2">
    <button type="button" data-computer-use-setup disabled={!target || !bridge?.openAgentSetup || opening}
      className="btn-outline text-ui px-3 py-1.5 disabled:opacity-50" onClick={async () => {
        if (!target || !bridge?.openAgentSetup) return;
        setOpening(true); setError(null);
        try { const result = await bridge.openAgentSetup(target); if (!result.ok) setError('Could not open this Agent’s setup. Refresh and try again.'); }
        catch { setError('Could not open this Agent’s setup. Try again.'); }
        finally { setOpening(false); }
      }}>{opening ? 'Opening…' : ready ? 'View access' : 'Set Up'}</button>
    <button type="button" disabled={!target || !bridge?.agentSetupReadiness || !state || opening}
      className="btn-outline text-ui px-3 py-1.5 disabled:opacity-50"
      onClick={() => setCheckIndex((value) => value + 1)}>Test setup</button>
    </div>
  </div>;
}

function ConnectionsList({ items, onChanged, onBrowserVerified, confirmations, onConfirmationChanged, workedAround, onToggleWorkAround, slug }: {
  items: NeededConnection[];
  onChanged: () => void;
  onBrowserVerified: () => Promise<void>;
  confirmations: ReadonlySet<string>;
  onConfirmationChanged: (account: string, confirmed: boolean) => void;
  workedAround: Set<string>;
  onToggleWorkAround: (key: string, on: boolean) => void;
  slug: string;
}) {
  const bridge = useDesktopBridge();
  return (
    <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      <ul className="space-y-2">
        {items.map((it) => {
          const key = it.account || it.label || '';
          return (
            <ConnectionRow
              key={key}
              item={it}
              slug={slug}
              onChanged={onChanged}
              onBrowserVerified={onBrowserVerified}
              confirmed={confirmations.has(key)}
              onConfirmationChanged={(confirmed) => onConfirmationChanged(key, confirmed)}
              workedAround={workedAround.has(key)}
              onToggleWorkAround={(on) => onToggleWorkAround(key, on)}
            />
          );
        })}
      </ul>
      {!bridge?.connectAccount && (
        <p className="text-reading text-ink-500 mt-2 ">
          Open this page in the Tukido app to sign in with one click — the app keeps a dedicated browser workspace your agents use.
        </p>
      )}
    </div>
  );
}

type ToolItem = { key: string; name: string };

function ToolRow({ item }: { item: ToolItem }) {
  const bridge = useDesktopBridge();
  const [state, setState] = useState<'unknown' | 'checking' | 'installed' | 'missing' | 'installing' | 'failed'>('unknown');
  const [note, setNote] = useState<string | null>(null);
  const canInstall = !!bridge?.installTool;

  useEffect(() => {
    let cancelled = false;
    const b = desktopBridge();
    if (!b?.checkTool) return;
    setState('checking');
    b.checkTool(item.key)
      .then((r) => { if (!cancelled) setState(r.ok && r.installed ? 'installed' : 'missing'); })
      .catch(() => { if (!cancelled) setState('unknown'); });
    return () => { cancelled = true; };
  }, [item.key]);

  const install = async () => {
    if (!bridge?.installTool) return;
    setState('installing'); setNote(null);
    try {
      const r = await bridge.installTool(item.key);
      if (r.ok && r.installed) { setState('installed'); setNote(r.alreadyInstalled ? 'Already installed.' : 'Installed.'); }
      else { setState('failed'); setNote(r.message || 'Install failed. The agent will install it on its first run instead.'); }
    } catch { setState('failed'); setNote('Install failed. The agent will install it on its first run instead.'); }
  };

  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-secondary text-ink-100">{item.name}</span>
          {state === 'installed' && <span className="text-secondary text-state-ok">installed</span>}
          {(state === 'missing' || state === 'failed') && <span className="text-secondary text-state-needs">not installed</span>}
          {state === 'checking' && <span className="text-secondary text-ink-500">checking…</span>}
        </div>
        {note && <p className="text-secondary text-ink-500 mt-0.5 leading-snug">{note}</p>}
      </div>
      {(state === 'missing' || state === 'failed' || state === 'installing') && canInstall && (
        <button type="button" onClick={install} disabled={state === 'installing'} className="btn-outline text-ui px-2.5 py-1 flex-none">
          {state === 'installing' ? 'Installing…' : state === 'failed' ? 'Retry' : 'Install'}
        </button>
      )}
    </li>
  );
}

function ToolsList({ items }: { items: ToolItem[] }) {
  const bridge = useDesktopBridge();
  return (
    <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      <ul className="space-y-2">
        {items.map((it) => <ToolRow key={it.key} item={it} />)}
      </ul>
      {!bridge?.installTool && (
        <p className="text-reading text-ink-500 mt-2 ">
          The agent installs anything missing the first time it runs. In the Tukido app you can install these ahead of time with one click.
        </p>
      )}
    </div>
  );
}

// KeyItem / KeyRow / KeysList moved to ./api-key-row (2026-07-18) — imported above.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:30" (24h, from <input type=time>) -> "9:30am" for the schedule NL the
// backend cron parser understands ("every day at 9:30am").
function to12h(hhmm: string): string {
  const [hStr, mStr] = (hhmm || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const ampm = h < 12 ? 'am' : 'pm';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

type Freq = 'day' | 'weekday' | 'week' | 'hour';
type Mode = 'recurring' | 'once';

// <input type="datetime-local"> emits "2026-06-15T09:00" in the browser's LOCAL
// time. Parse it as local and emit an absolute ISO instant (UTC Z) for fireAt —
// the backend stores the absolute moment and the plugin hands it to
// create_scheduled_task's fireAt verbatim.
function localDatetimeToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// "now" as a datetime-local string, for the input's min (no past one-time runs).
function nowLocalDatetime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Friendly readback of a chosen one-time instant.
function humanizeLocal(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Inline schedule picker — the fix for "Set schedule navigates away". Pick a
 * cadence right here; POST to /agents/:slug/schedule; refresh.
 *
 * Two trigger shapes ship in the UI: RECURRING (cron) and ONE-TIME (fireAt, runs
 * once then auto-disables). CONDITION triggers ("only when X") are deliberately
 * NOT a UI input yet: the gate is enforced in the plugin's /implexa:run-scheduled
 * wrapper, which ships on a plugin release, not this dashboard deploy. Exposing
 * the input before every user's plugin enforces it would let an unmet condition
 * run every time — worse than not offering it. So it stays a "coming next" note.
 */
export type SchedulePickerInitial = {
  mode?: Mode;
  freq?: Freq;
  time?: string;
  weekday?: number;
};

export function SchedulePicker({ slug, onSaved, initial }: { slug: string; onSaved: () => void; initial?: SchedulePickerInitial }) {
  const supabase = createClient();
  // Hydrate from an existing routine when editing (initial), else the plain
  // create-time defaults. This is what makes "Edit" open on the ACTUAL schedule
  // (e.g. daily at 12pm) instead of a hard-coded 9am.
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'recurring');
  const [freq, setFreq] = useState<Freq>(initial?.freq ?? 'day');
  const [time, setTime] = useState(initial?.time ?? '09:00');
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1); // Monday
  const [fireAtLocal, setFireAtLocal] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function buildNl(): string {
    const t = to12h(time);
    if (freq === 'hour') return 'every hour';
    if (freq === 'weekday') return `every weekday at ${t}`;
    if (freq === 'week') return `every ${WEEKDAYS[weekday].toLowerCase()} at ${t}`;
    return `every day at ${t}`;
  }

  async function save() {
    setErr(null);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let body: Record<string, unknown>;
    if (mode === 'once') {
      const iso = localDatetimeToIso(fireAtLocal);
      if (!iso) { setErr('Pick a date and time for the one-time run.'); return; }
      if (new Date(iso).getTime() <= Date.now()) { setErr('Pick a time in the future.'); return; }
      body = { trigger: 'once', fireAt: iso, timezone };
    } else {
      body = { trigger: 'cron', scheduleNl: buildNl(), timezone };
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/schedule`, {
        jwt, method: 'POST', body,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not set the schedule. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectCls = 'bg-ink-900 border border-ink-700 rounded-md text-ui px-2 py-1 text-ink-100';
  const tabCls = (on: boolean) =>
    `text-secondary font-medium rounded-md px-2.5 py-1 transition-colors ${
      on ? 'bg-ink-100 text-ink-900' : 'border border-ink-700 text-ink-400 hover:text-ink-200'
    }`;

  return (
    <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { setMode('recurring'); setErr(null); }} className={tabCls(mode === 'recurring')}>Recurring</button>
        <button type="button" onClick={() => { setMode('once'); setErr(null); }} className={tabCls(mode === 'once')}>One-time</button>
      </div>

      {mode === 'recurring' ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={selectCls}>
            <option value="day">Every day</option>
            <option value="weekday">Every weekday</option>
            <option value="week">Weekly</option>
            <option value="hour">Every hour</option>
          </select>
          {freq === 'week' && (
            <select value={weekday} onChange={(e) => setWeekday(parseInt(e.target.value, 10))} className={selectCls}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
          {freq !== 'hour' && (
            <>
              <span className="text-secondary text-ink-500">at</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectCls} />
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-secondary text-ink-500">Run once on</span>
          <input
            type="datetime-local"
            value={fireAtLocal}
            min={nowLocalDatetime()}
            onChange={(e) => setFireAtLocal(e.target.value)}
            className={selectCls}
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className={saving ? 'btn-outline text-ui px-3 py-1.5 opacity-50' : 'btn-success text-ui px-3 py-1.5'}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
        <span className="text-secondary text-ink-500">
          {mode === 'once'
            ? (fireAtLocal ? `Runs once on ${humanizeLocal(fireAtLocal)}, then turns off.` : 'Pick when it should run once.')
            : `Runs ${buildNl()}.`}
        </span>
        {err && <span className="text-secondary text-state-fail">{err}</span>}
      </div>
      <p className="text-reading text-ink-500 ">Condition triggers (“only when a new file appears”) are coming next.</p>
    </div>
  );
}

function StepRow({ step, slug, optIns, onToggleOptIn, onChanged, onBrowserVerified, defaultOpen, savingGroup, workedAround, onToggleWorkAround, permissionNote, isActive = false }: {
  step: ActivationStep;
  slug: string;
  optIns: Record<string, boolean>;
  onToggleOptIn: (group: string, on: boolean) => void;
  onChanged: () => void;
  onBrowserVerified: () => Promise<void>;
  defaultOpen?: boolean;
  savingGroup?: string | null;
  permissionNote?: string | null;
  isActive?: boolean;
  workedAround: Set<string>;
  onToggleWorkAround: (key: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const items = (step.data?.items ?? []) as PermissionItem[];
  const requiredItems = step.id === 'permissions' ? items.filter((it) => it.tier === 2 && !it.optional) : [];
  const permissionLocallyComplete = step.id === 'permissions' && requiredItems.length > 0
    && requiredItems.every((it) => it.reusableCommandApproval ? it.granted : optIns[it.group]);
  const needed = (step.data?.needed ?? []) as NeededConnection[];
  const [confirmations, setConfirmations] = useState<Set<string>>(() => new Set());
  const unconfirmedAccounts = step.id === 'connections'
    ? needed.flatMap(({ account }) => account && usesProviderBrowserSession(account) && !confirmations.has(account) ? [account] : [])
    : [];
  const waitingForSessionCheck = unconfirmedAccounts.some(account => !workedAround.has(account));
  const commandsAreAutomatic = step.id === 'permissions' && step.status !== 'todo' && items.some(item =>
    item.group === 'shell' && item.granted && item.grantScope === 'account_until_revoked');
  const stepDetail = waitingForSessionCheck ? 'Check the provider browser sessions.'
    : unconfirmedAccounts.length ? 'Using a workaround for unverified provider accounts.'
    : commandsAreAutomatic ? 'Command permission is automatic.' : step.detail;
  const effectiveStatus = waitingForSessionCheck ? 'todo' : permissionLocallyComplete ? 'done' : step.status;
  const isTodo = effectiveStatus === 'todo';

  function recordConfirmation(account: string, confirmed: boolean) {
    setConfirmations(current => {
      if (current.has(account) === confirmed) return current;
      const next = new Set(current);
      if (confirmed) next.add(account);
      else next.delete(account);
      return next;
    });
  }

  // Resolve the CTA target/behavior per step.
  let cta: React.ReactNode = null;
  if (step.id === 'schedule' && step.data?.reason === 'training_served_snapshot_version_mismatch' && !step.data?.requiresScheduleConfiguration) {
    cta = <a href={`/training/${encodeURIComponent(slug)}`} className="btn-outline text-secondary px-2.5 py-1">Review Training</a>;
  } else if (step.id === 'schedule') {
    // Inline picker (the fix): toggle a panel, never navigate away. Available
    // when todo ("Set schedule") and when done ("Change").
    const label = effectiveStatus === 'done' ? 'Change' : (step.cta || 'Set schedule');
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-ui px-2.5 py-1">{open ? 'Hide' : label}</button>;
  } else if (step.id === 'tools' && ((step.data?.items ?? []) as unknown as ToolItem[]).length > 0) {
    // Always offered (status is 'auto'): in the app each tool gets a one-click
    // Install; on the web it explains the first-run auto-install.
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-ui px-2.5 py-1">{open ? 'Hide' : 'View'}</button>;
  } else if (step.id === 'permissions' && ((step.data?.items ?? []) as PermissionItem[]).length > 0) {
    // Always expandable (even when fully granted) so the user can see what's
    // automatic vs. explicitly granted to this agent, and revoke it.
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-ui px-2.5 py-1">{open ? 'Hide' : (step.cta || 'View')}</button>;

  } else if (step.id === 'api-keys' && ((step.data?.items ?? []) as unknown as KeyItem[]).length > 0) {
    // Expandable whether todo (Add key) or done (View) — the paste/create flow is
    // inline, never a navigation. Soft gate: this never blocks Activate.
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-ui px-2.5 py-1">{open ? 'Hide' : (step.cta || 'Add key')}</button>;
  } else if (step.id === 'connections' && needed.length > 0) {
    cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-ui px-2.5 py-1">{open ? 'Hide' : (waitingForSessionCheck ? 'Browser sign-in' : isTodo ? step.cta || 'Connect' : 'View')}</button>;
  } else if (isTodo && step.cta) {
    cta = <button type="button" className="btn-outline text-ui px-2.5 py-1">{step.cta}</button>;
  }

  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <StatusDot status={effectiveStatus} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-secondary font-medium text-ink-100">{step.title}</span>
              {effectiveStatus === 'auto' && <span className="text-secondary uppercase tracking-wide text-ink-500">auto</span>}
            </div>
            <p className="text-secondary text-ink-400 mt-0.5 leading-snug">{stepDetail}</p>
          </div>
        </div>
        {cta && <div className="flex-none">{cta}</div>}
      </div>
      {step.id === 'permissions' && open && items.length > 0 && (
        <>
          <PermissionList items={items} optIns={optIns} onToggle={onToggleOptIn} savingGroup={savingGroup} isActive={isActive} />
          {permissionNote && (
            <p className="mt-2 text-reading text-state-ok ">{permissionNote}</p>
          )}
        </>
      )}
      {step.id === 'connections' && open && needed.length > 0 && (
        <ConnectionsList items={needed} onChanged={onChanged} onBrowserVerified={onBrowserVerified} confirmations={confirmations} onConfirmationChanged={recordConfirmation} workedAround={workedAround} onToggleWorkAround={onToggleWorkAround} slug={slug} />
      )}
      {step.id === 'tools' && open && (
        <ToolsList items={(step.data?.items ?? []) as unknown as ToolItem[]} />
      )}
      {step.id === 'api-keys' && open && (
        <KeysList
          items={(step.data?.items ?? []) as unknown as KeyItem[]}
          slug={slug}
          trustLine={(step.data as { trustLine?: string } | undefined)?.trustLine}
          onChanged={onChanged}
        />
      )}
      {step.id === 'schedule' && open && (
        <SchedulePicker slug={slug} onSaved={() => { setOpen(false); onChanged(); }} />
      )}
    </li>
  );
}

const STATE_BADGE: Record<ActivationChecklist['state'], { label: string; classes: string }> = {
  created:         { label: 'Not activated', classes: 'bg-ink-800 text-ink-300' },
  activating:      { label: 'Activating',    classes: 'bg-sky-500/15 text-state-running' },
  active:          { label: 'Active',        classes: 'bg-emerald-500/15 text-state-ok' },
  needs_attention: { label: 'Needs attention', classes: 'bg-amber-500/20 text-state-needs' },
};

export function ActivationCard({
  checklist: originalChecklist,
  proficiency,
  surface = 'activation',
  runInputs,
  statusUnavailable,
  revisePending,
  setupBlockedReason,
}: {
  checklist: ActivationChecklist;
  proficiency?: 'novice' | 'beginner' | 'pro' | 'advanced' | null;
  /** setup = reusable permissions/access editor inside the agent Setup tab. */
  surface?: 'activation' | 'setup';
  /**
   * The pinned version + input contract of the agent this card can Run.
   *
   * REQUIRED — deliberately not optional-with-a-default. Without it <AgentActions/>
   * renders no "Run inputs" section and posts no envelope, so a workflow version
   * that declares a contract answers Run now with a flat
   * `versioned_input_envelope_required` refusal and no way to satisfy it from this
   * screen. A default would let a new mount re-create exactly that bug in silence;
   * with none, tsc refuses to compile the surface that forgets it.
   *
   * null means the workflow could NOT be read — NOT "this agent needs no inputs".
   * The card renders that difference (see the notice by Run now) rather than
   * passing an unavailable read off as an empty one.
   */
  runInputs: WorkflowRunInputs | null;
  /** Whether pending-run/edit lifecycle authority could be read. */
  statusUnavailable: boolean;
  /** Whether a known revise request is already queued or running. */
  revisePending: boolean;
  /** Existing marketplace acquisition/update must finish before native completion. */
  setupBlockedReason?:string;
}) {
  const [checked, setChecked] = useState<{ base: ActivationChecklist; value: ActivationChecklist } | null>(null);
  const checklist = checked?.base === originalChecklist ? checked.value : originalChecklist;
  const setupSurface = surface === 'setup';
  const expectedVersionId=runInputs?.workflowVersionId;
  const versionedSetup=!!expectedVersionId||!!checklist.setupContext?.versionId;
  const boundSetupVersion=!!expectedVersionId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(expectedVersionId)&&checklist.setupContext?.versionId===expectedVersionId;
  const completionKey=JSON.stringify([checklist.setupContext?.accountId || checklist.commandApprovalAccountId,checklist.slug,expectedVersionId]);
  const currentCompletion=useRef(completionKey);currentCompletion.current=completionKey;
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const completionAttempts=useRef(new Set<string>());
  const [completionRetry,setCompletionRetry]=useState(0);
  // Guided = novice/beginner: friendlier "Turn it on" framing + a reassurance
  // line. Pro/advanced keep the terser "Activate". (audit #7)
  const guided = proficiency === 'novice' || proficiency === 'beginner';
  const permStep = checklist.steps.find((s) => s.id === 'permissions');
  const tier2 = ((permStep?.data?.items ?? []) as PermissionItem[]).filter((i) => i.tier === 2);

  // Seed local opt-ins from what's ALREADY granted server-side (item.granted), so
  // granted Tier-2 show "Allowed" and only the ungranted ones need a tap. Without
  // this seed, an already-active agent that needs a new grant looked un-grantable.
  const [optIns, setOptIns] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const i of tier2) if (i.granted && i.grantScope !== 'account_until_revoked') seed[i.group] = true;
    return seed;
  });
  // Connections the user chose to "let Claude figure out an alternative" for (keyed
  // by account/label). Ticking all the unmet ones satisfies Connections so the
  // normal "Turn it on" goes green — no separate "anyway" button.
  const workAroundStoreKey = `implexa:connection-workarounds:${checklist.slug}`;
  const [workedAround, setWorkedAround] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(workAroundStoreKey);
      const arr = saved ? JSON.parse(saved) : [];
      if (Array.isArray(arr)) setWorkedAround(new Set(arr.map((x) => String(x)).filter(Boolean)));
    } catch { /* localStorage unavailable/corrupt: checkbox becomes session-only */ }
  }, [workAroundStoreKey]);
  const toggleWorkAround = (key: string, on: boolean) => setWorkedAround((prev) => {
    const next = new Set(prev); if (on) next.add(key); else next.delete(key);
    try {
      if (next.size) window.localStorage.setItem(workAroundStoreKey, JSON.stringify([...next]));
      else window.localStorage.removeItem(workAroundStoreKey);
    } catch { /* localStorage unavailable: still update this page */ }
    return next;
  });
  // The build inferred a recurring cadence → we adopt it on activate (opt-out to
  // on-demand). suggestedCadence (e.g. "every monday at 9am") comes from the
  // Schedule step; forceOnDemand is the user's "run on-demand instead" choice.
  const suggestedCadence = (checklist.steps.find((s) => s.id === 'schedule')?.data as { suggestedCadence?: string } | undefined)?.suggestedCadence || null;
  const [forceOnDemand, setForceOnDemand] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const latestConnectionRead = useRef(0);
  const currentChecklist = useRef(originalChecklist);
  currentChecklist.current = originalChecklist;

  async function refreshConnectionsInPlace() {
    const read = ++latestConnectionRead.current;
    const base = originalChecklist;
    const { slug, setupContext } = base;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || (setupContext && session.user.id !== setupContext.accountId)) return;
      const payload = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/activation`, {
        jwt: session.access_token, signal: AbortSignal.timeout(8000),
      });
      const value = mapActivationChecklist(payload, slug);
      if (!mounted.current || currentChecklist.current !== base || read !== latestConnectionRead.current || value?.slug !== slug) return;
      if (setupContext && (value.setupContext?.accountId !== setupContext.accountId
          || value.setupContext?.versionId !== setupContext.versionId)) return;
      setChecked({ base, value });
    } catch { /* Keep the visible provider result even if setup could not refresh. */ }
  }

  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(checklist.state === 'active');
  const [savedLocally, setSavedLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localGrantNote, setLocalGrantNote] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [macAccessEvidence, setMacAccessEvidence] = useState<{ key: string; ready: boolean } | null>(null);
  const setupTarget: AgentSetupTarget | null = checklist.setupContext ? {
    slug: checklist.slug, accountId: checklist.setupContext.accountId,
    versionId: checklist.setupContext.versionId, requiredRouteClass: checklist.setupContext.requiredRouteClass,
  } : null;
  const setupTargetKey = JSON.stringify(setupTarget);
  const onMacAccessReady = useCallback((ready: boolean) => setMacAccessEvidence({ key: setupTargetKey, ready }), [setupTargetKey]);
  const computerUseReady = macAccessEvidence?.key === setupTargetKey && macAccessEvidence.ready;

  // Persist the given opt-ins to the backend. The desktop enforces this exact
  // agent's policy at spawn time; never widen ~/.claude/settings.json globally.
  // Used
  // both by the Activate/Grant button and by an auto-save on toggle for an
  // already-active agent (which has no Activate button to save behind).
  async function persistGrants(opts: Record<string, boolean>, workAround = false, onDemand = false) {
    if(setupSurface&&versionedSetup&&!boundSetupVersion)throw new Error('The agent changed. Reload Setup.');
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    if(setupSurface&&boundSetupVersion&&(!mounted.current||currentCompletion.current!==completionKey||session?.user?.id!==checklist.setupContext?.accountId))throw new Error('The account or agent changed. Reload Setup.');
    const result=await callBackend(`/api/v2/agents/${encodeURIComponent(checklist.slug)}/activate`, {
      jwt, method: 'POST', body: { optIns: opts, ...(workAround ? { workAround: true } : {}), ...(onDemand||setupSurface ? { onDemand: true } : {}),...(setupSurface&&boundSetupVersion?{completeSetup:true,expectedVersionId}: {}) },
    });
    if(result?.ok!==true)throw new Error('Setup could not be completed. Try again.');
    if (mounted.current&&currentCompletion.current===completionKey&&requiredTier2.some((item) => opts[item.group])) {
      setLocalGrantNote('Saved for this agent only. The grant applies to future runs until you revoke it.');
    }
  }

  // workAround → soft-activate past an unmet connection. onDemand → opt OUT of
  // auto-adopting the build-inferred cadence (the "run on-demand instead" choice).
  async function activate(workAround = false, onDemand = false) {
    setError(null);
    setActivating(true);
    const startedFor=completionKey;
    try {
      await persistGrants(optIns, workAround, onDemand);
      if(!mounted.current||currentCompletion.current!==startedFor)return;
      setActivated(true);
      setSavedLocally(true);
      router.refresh();
    } catch (e) {
      if(mounted.current&&currentCompletion.current===startedFor)setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      if(mounted.current&&currentCompletion.current===startedFor)setActivating(false);
    }
  }

  // Optional Tier-2 grants (today: unattended send/post) never block activation.
  // Manifest-declared shell/external access is required and gates activation.
  const requiredTier2 = tier2.filter((i) => !i.optional);
  const allSavedGranted = requiredTier2.every((i) => i.granted || (savedLocally && i.group !== 'shell'));
  const allLocalGranted = requiredTier2.every((i) => i.reusableCommandApproval ? i.granted : optIns[i.group]);
  const firstMissingPermission = requiredTier2.find((item) => item.reusableCommandApproval ? !item.granted : !optIns[item.group]);
  const firstMissingUsesSharedApproval = firstMissingPermission?.reusableCommandApproval && !firstMissingPermission.commandApprovalDisabledForAgent;
  const computerUseRequired = checklist.setupContext?.requiredRouteClass === 'computer_use'
    || (!checklist.setupContext && checklist.steps.some((step) => step.id === 'computer-use'));
  const showMacSetup = computerUseRequired || checklist.setupContext?.requiredRouteClass === 'browser'
    || !!(checklist.requiresLocal && checklist.setupContext);
  const computerUseSatisfied = !computerUseRequired || !!computerUseReady;
  const isActive = checklist.state === 'active' || activated;
  // Active, but a Tier-2 grant is still missing -> the wedged "Fix"/needs-you case.
  const needsGrant = isActive && !allSavedGranted;
  // Unmet connections (the one hard gate). Each can be satisfied EITHER by signing
  // in (status → reachable) OR by ticking "let Claude figure out an alternative".
  const connStep = checklist.steps.find((s) => s.id === 'connections');
  const unmetConns = (((connStep?.data?.needed ?? []) as NeededConnection[])
    .filter((c) => c.status !== 'reachable'));
  const connKey = (c: NeededConnection) => c.account || c.label || '';
  // Connections are RESOLVED when the step is no longer todo (all signed in), or
  // every unmet one has been worked around.
  const connectionsResolved = !connStep || connStep.status !== 'todo'
    || (unmetConns.length > 0 && unmetConns.every((c) => workedAround.has(connKey(c))));
  // Ready to turn on: permissions in hand + connections resolved (signed in OR
  // worked around) + not already active. (canActivate is the server's view; we OR
  // in the work-around so ticking the box flips the button green.)
  const ready = !isActive && allLocalGranted && computerUseSatisfied && (checklist.canActivate || connectionsResolved);
  const anyWorkedAround = unmetConns.some((c) => workedAround.has(connKey(c)));

  function allowFirstRequiredPermission() {
    const missing = firstMissingPermission;
    if (!missing) return;
    toggleOptIn(missing.group, true);
    const selector = `[data-permission-action="${CSS.escape(missing.group)}"]`;
    const button = document.querySelector<HTMLButtonElement>(selector);
    button?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => button?.focus(), 250);
  }

  // Honest hands-free contract: an active agent only earns the green "Active"
  // badge once its Class-2 grants are verified. A browser agent on a machine that
  // hasn't paired Chrome is active-but-unverified — show an amber "needs a check"
  // and the one-tap browser grant, never a green light it hasn't earned. Absent
  // verification (older backend) defaults to verified so the badge never regresses.
  const verification = checklist.verification ?? { verified: true, checks: [] };
  // readyToRun===false means a required capability has no viable tool (see
  // CapabilityGapsNotice above) — the same honesty rule as the Class-2 grant
  // check below: don't claim "runs hands-free" when part of the result can't
  // be delivered. undefined (older backend) never blocks, matching the rest
  // of this file's absent-field-means-verified convention.
  const capabilityReady = checklist.readyToRun !== false;
  const automaticReady=setupSurface&&boundSetupVersion&&!statusUnavailable&&!setupBlockedReason&&!revisePending&&!isActive&&!activating
    &&checklist.setupReadAvailable===true&&checklist.readyToRun===true
    &&Number(checklist.blockingQuestions??checklist.pendingQuestions??0)===0
    &&allLocalGranted&&computerUseSatisfied&&(!showMacSetup||computerUseReady)
    &&(checklist.canActivate||(anyWorkedAround&&connectionsResolved));
  useEffect(()=>{
    if(!automaticReady)return;
    const attempt=completionKey+':'+completionRetry;
    if(completionAttempts.current.has(attempt))return;
    completionAttempts.current.add(attempt);
    void activate(anyWorkedAround,true);
  },[automaticReady,completionKey,completionRetry]); // Existing activation writer, once per reviewed version or explicit retry.
  useEffect(()=>{setActivated(checklist.state==='active');setSavedLocally(false);setError(null);setActivating(false);setOptIns(Object.fromEntries(tier2.filter(item=>item.granted && item.grantScope!=='account_until_revoked').map(item=>[item.group,true])));},[completionKey]);
  const verifiedHandsFree = isActive && verification.verified && computerUseSatisfied && capabilityReady;
  const setupReadUnknown=!!statusUnavailable||checklist.setupReadAvailable!==true;
  const setupReady=!setupReadUnknown&&!setupBlockedReason&&!revisePending&&isActive&&allSavedGranted&&computerUseSatisfied&&(!showMacSetup||computerUseReady)&&checklist.readyToRun===true;

  const browserCheck = verification.checks.find((c) => c.key === 'browser' && c.status !== 'ok');
  // Override the green "Active" chip ONLY for a genuinely-active-but-unverified
  // agent — never mask 'needs_attention' or a not-yet-activated state.
  const badge = (checklist.state === 'active' && (!verification.verified || !computerUseSatisfied || !capabilityReady))
    ? { label: 'Active · needs a check', classes: 'bg-amber-500/20 text-state-needs' }
    : STATE_BADGE[checklist.state];

  // A recommended (optional) Tier-2 grant the user hasn't allowed yet, while the
  // agent is already active — nudge them to allow it so runs don't stall. Send/post
  // is different: off means "draft/hold for approval", not a stall risk.
  const ungrantedOptional = tier2.filter((i) => i.optional && i.group !== 'send' && !optIns[i.group]);
  const showStallNudge = isActive && allSavedGranted && ungrantedOptional.length > 0;

  // Toggling a grant updates local state. On an already-active agent persist the
  // one capability through the dedicated grant endpoint. This is what makes
  // revocation real: the activation endpoint only turns an agent on and must not
  // double as a misleading grant store.
  async function toggleOptIn(group: string, on: boolean) {
    if(setupSurface&&versionedSetup&&!boundSetupVersion){setError('The agent changed. Reload Setup.');return;}
    const permission = tier2.find((item) => item.group === group);
    if (on && permission?.reusableCommandApproval && !permission.commandApprovalDisabledForAgent) {
      if (savingGroup) return;
      setSavingGroup(group);
      setError(null);
      const startedFor = completionKey;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accountId = checklist.commandApprovalAccountId;
        if (!accountId || session?.user.id !== accountId || !mounted.current
          || currentCompletion.current !== startedFor) throw Error('The account changed. Reload Setup.');
        await saveAgentCommandApproval(accountId, true, session.access_token);
        if (!mounted.current || currentCompletion.current !== startedFor) return;
        await refreshConnectionsInPlace();
        router.refresh();
      } catch (error) {
        if (mounted.current && currentCompletion.current === startedFor) {
          setError(error instanceof Error ? error.message : 'Could not save command permission. Try again.');
        }
      } finally {
        if (mounted.current && currentCompletion.current === startedFor) setSavingGroup(null);
      }
      return;
    }
    const next = { ...optIns, [group]: on };
    setOptIns(next);
    if (isActive || permission?.commandApprovalDisabledForAgent || permission?.grantScope === 'account_until_revoked') {
      setSavingGroup(group);
      setError(null);
      const startedFor = completionKey;
      supabase.auth.getSession()
        .then(async ({ data }) => {
          if (permission?.reusableCommandApproval) {
            const accountId = checklist.commandApprovalAccountId;
            if (!accountId || data.session?.user.id !== accountId || !await commandApprovalAccountMatches(accountId)) {
              throw Error('Use the same Tukido account in Desktop and Dashboard.');
            }
          }
          if (!mounted.current || currentCompletion.current !== startedFor) throw Error('The account changed. Reload Setup.');
          return callBackend(`/api/v2/agents/${encodeURIComponent(checklist.slug)}/permissions/${encodeURIComponent(group)}`, {
            jwt: data.session?.access_token,
            method: 'POST',
            body: { granted: on },
          });
        })
        .then(async (res) => {
          if (res?.ok !== true) throw Error('Permission could not be saved.');
          if (!mounted.current || currentCompletion.current !== startedFor) return;
          if (res.deactivated === true) setActivated(false);
          setLocalGrantNote(on
            ? 'Allowed for this agent only, across future runs, until you revoke it.'
            : permission && !permission.optional
              ? 'Revoked for this agent. The agent is now inactive, and any recurring schedule is paused until you grant it and activate again.'
              : 'Autopilot access is off for this agent. Draft-and-hold work stays active.');
          if (group === 'shell') await refreshConnectionsInPlace();
          router.refresh();
        })
        .catch((error) => {
          if (mounted.current && currentCompletion.current === startedFor) {
            setError(error instanceof Error ? error.message : 'Could not save that grant. Try again.');
            setOptIns((s) => ({ ...s, [group]: !on }));
          }
        })
        .finally(() => { if (mounted.current && currentCompletion.current === startedFor) setSavingGroup(null); });
    }
  }

  return (
    <div className={setupSurface ? 'card mb-6 agent-required-setup' : 'card max-w-2xl'}>
      {setupSurface&&<div role="status" className={`agent-setup-readiness ${setupReadUnknown?'unknown':setupReady?'ready':'needed'}`}><strong>{setupReadUnknown?'Setup status unavailable':setupReady?'Ready to run':'Complete required setup'}</strong><span>{setupReadUnknown?'Reload to check what this agent needs.':setupReady?'Run whenever you’re ready. Scheduled runs are controlled separately below.':'The rows below show what still needs your attention.'}</span></div>}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-50 truncate">
            {setupSurface ? 'Required setup' : checklist.name}
          </h2>
          {setupSurface ? (
            <p className="text-reading text-ink-400 mt-1 ">
              This agent is ready once the required items are done.
            </p>
          ) : checklist.summary ? (
            <p className="text-reading text-ink-400 mt-1 ">{checklist.summary}</p>
          ) : null}
          {checklist.requiresLocal && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-reading text-ink-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 flex-none" aria-hidden />
              Runs on your computer, in the Tukido app (not on a server).
            </p>
          )}
        </div>
        {!setupSurface && <span className={`flex-none text-secondary font-medium rounded-full px-2.5 py-1 ${badge.classes}`}>{badge.label}</span>}
      </div>

      {!setupSurface && checklist.state !== 'active' && (
        <p className="text-secondary text-ink-500 mb-1">
          {checklist.stepsLeft === 0 ? 'Ready to switch on.' : `${checklist.stepsLeft} step${checklist.stepsLeft === 1 ? '' : 's'} left`}
        </p>
      )}

      {/* Guided reassurance for novice/beginner: take the fear out of the steps. */}
      {!setupSurface && guided && checklist.state !== 'active' && (
        <p className="text-reading text-ink-300 mb-2 rounded-md bg-brand-500/10 border border-brand-500/20 px-3 py-2 ">
          Don&apos;t worry about the details below; they&apos;re here if you want them. When the steps are green, hit <span className="font-medium text-ink-100">Turn it on</span> and your agent is live.
        </p>
      )}

      {showMacSetup && <AgentMacSetup target={setupTarget} onReady={onMacAccessReady} />}
      {setupSurface && setupTarget?.requiredRouteClass === 'browser' && <details className="text-secondary text-ink-500">
        <summary>Advanced beta browser diagnostics</summary>
        <ManagedBrowserOwnerDeclaration key={setupTargetKey}
          target={{ accountId: setupTarget.accountId, slug: setupTarget.slug, versionId: setupTarget.versionId }} />
      </details>}

      <ul className="divide-y divide-ink-800">
        {checklist.steps.filter((s) => s.id !== 'computer-use'&&(!setupSurface||!['schedule','notifications'].includes(s.id))).map((s) => (
          <StepRow
            key={`${checklist.slug}:${checklist.setupContext?.accountId || ''}:${s.id}`}
            step={s}
            slug={checklist.slug}
            optIns={optIns}
            onToggleOptIn={toggleOptIn}
            onChanged={() => router.refresh()}
            onBrowserVerified={refreshConnectionsInPlace}
            savingGroup={savingGroup}
            isActive={isActive}
            permissionNote={localGrantNote}
            workedAround={workedAround}
            onToggleWorkAround={toggleWorkAround}
            defaultOpen={(needsGrant && s.id === 'permissions') || (showStallNudge && s.id === 'permissions') || (s.id === 'connections' && s.status === 'todo')}
          />
        ))}
      </ul>

      {setupSurface&&checklist.steps.some(step=>step.id==='notifications')&&<><h3 className="mt-6 mb-2 text-ui font-medium">Optional</h3><ul>{checklist.steps.filter(step=>step.id==='notifications').map(step=><StepRow key={step.id} step={step} slug={checklist.slug} optIns={optIns} onToggleOptIn={toggleOptIn} onChanged={()=>router.refresh()} onBrowserVerified={refreshConnectionsInPlace} savingGroup={savingGroup} permissionNote={localGrantNote} workedAround={workedAround} onToggleWorkAround={toggleWorkAround}/>)}</ul></>}

      {/* Optional quality layer at activation, where the user is deciding how
          this agent should run. It never blocks activation. The same control also
          lives in Setup so the decision is reversible later. */}
      {!setupSurface && <div className="mt-4">
        <ImplexaJudgePolicy slug={checklist.slug} compact />
      </div>}

      {/* Provider access is provisioning, not a post-activation reward. Keep it
          outside the lifecycle CTA branches so an existing agent can see and
          repair its real browser/key route from Setup as well as first-run. */}
      <div className="mt-4">
        <MarketplaceExecutionRequirementsCard contract={checklist.executionRequirements} />
      </div>
      <div className="mt-4" id="agent-access-tools">
        <ActivationRequirements req={checklist.requirements} slug={checklist.slug} target={setupTarget} onBrowserVerified={refreshConnectionsInPlace} />
      </div>
      {(!!checklist.machineTools?.requirements.length || !!checklist.localToolDeclarations?.length) && <div className="mt-4">
        <DeclaredMachineTools tools={checklist.machineTools} declarations={checklist.localToolDeclarations} />
      </div>}

      {/* Capabilities with NO viable tool (server-derived from capability_setup).
          requirements above cannot show these — a gap has no step reflecting a
          working tool. Never blocks activation; a required gap only explains why
          "ready to run" is withheld. */}
      <CapabilityGapsNotice gaps={checklist.capabilityGaps} />

      <div className="mt-5 flex items-start gap-3">
        {setupSurface&&versionedSetup&&!isActive?<div role="status" className="text-secondary text-ink-400">{activating?'Completing setup…':error?<><p className="text-state-fail">{error}</p><button type="button" className="btn-outline mt-3" disabled={!automaticReady} onClick={()=>{setError(null);setCompletionRetry(n=>n+1);}}>Try again</button></>:setupBlockedReason?setupBlockedReason:!boundSetupVersion?'The agent changed. Reload Setup.':statusUnavailable||checklist.setupReadAvailable!==true?'Setup status could not be checked. Reload to try again.':revisePending?'Setup will finish after the pending edit is ready.':'Complete the required items above.'}{suggestedCadence&&<p className="mt-2 text-secondary">Suggested schedule: {suggestedCadence}. Setup does not start it; enable it in Schedule below.</p>}</div>:setupSurface && isActive && allSavedGranted ? null : isActive && allSavedGranted ? (
          // The moment of highest motivation must not dead-end at "Active."
          // (founder: "I activated this agent but what to do next, Im clueless").
          // Offer the first run right here; the schedule row above covers later.
          <div className="flex flex-col gap-2">
            {verifiedHandsFree ? (
              <span className="text-secondary text-state-ok">✓ Active — runs hands-free. Take it for its first run:</span>
            ) : !computerUseSatisfied ? (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2.5">
                <p className="text-reading text-state-needs font-medium">Active — Mac access needs setup</p>
                <p className="text-reading text-state-needs mt-0.5 ">Open Permissions &amp; access above and grant Screen Recording plus Accessibility to Tukido before this agent reaches its web-app step.</p>
              </div>
            ) : browserCheck ? (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2.5">
                <p className="text-reading text-state-needs font-medium">Active — one check left before it runs on its own</p>
                <p className="text-secondary text-state-needs mt-0.5 leading-snug">
                  {browserCheck.status === 'unknown'
                    ? 'This agent works in your browser. We couldn’t confirm your browser is connected yet — grant it once and it’ll run unattended.'
                    : 'This agent works in your browser. Connect it once and it’ll run unattended — until then a run will pause to ask.'}
                </p>
                <div className="mt-2">
                  <AgentBrowserConnect
                    slug={checklist.slug}
                    name={checklist.name}
                    domains={browserCheck.domains ?? []}
                  />
                </div>
              </div>
            ) : !capabilityReady ? (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2.5">
                <p className="text-reading text-state-needs font-medium">Active — can&apos;t yet deliver part of its result</p>
                <p className="text-secondary text-state-needs mt-0.5 leading-snug">See the gap above. A run will still work, just without that part, until it&apos;s resolved.</p>
              </div>
            ) : (
              <span className="text-secondary text-state-ok">✓ Active. Take it for its first run:</span>
            )}
            {showStallNudge && (
              <p className="text-reading text-state-needs max-w-md">
                Recommended: allow “{ungrantedOptional[0].label}” in Permissions above — without it a scheduled run can stall waiting on a prompt. (Allowing saves instantly.)
              </p>
            )}
            {/* The agent's questions live RIGHT HERE, at the moment of Run, so
                they can never be missed (founder: "you could have shown the
                questions during Run; I got lost in the middle"). The card
                self-hides when the agent has none. */}
            <div id="agent-setup" className="scroll-mt-20 my-1">
              <AgentSetupCard slug={checklist.slug} source={checklist.source} onSaved={() => router.refresh()} />
            </div>
            <AgentFeedback slug={checklist.slug} name={checklist.name} statusUnavailable={statusUnavailable} revisePending={revisePending} />
            {/* An UNREADABLE run-input contract is not an ABSENT one. Both arrive
                at <AgentActions/> as the same three nulls, so if this notice were
                dropped a transient read failure would render as the confident
                claim "this agent needs no inputs" — and Run now would be refused
                with backend jargon and no explanation. Run stays enabled, because
                an agent that genuinely declares no inputs runs fine and that is
                the common case; what the user gets is the reason, in advance. */}
            {runInputs === null && (
              <p className="text-reading text-state-needs max-w-md">
                We couldn’t load what this agent asks for before a run. You can still start it —
                but if it does ask for files or links, this run will be turned down until that
                loads. Reload the page to try again.
              </p>
            )}
            <div className="flex items-start gap-4 flex-wrap">
              {/* The versioned run-input props are NOT optional decoration: a
                  pinned version that declares an input contract makes the
                  run-request endpoint refuse anything without the envelope, and
                  only these three let <AgentActions/> render the inputs form that
                  builds it. Omitting them here is what made "Run now" from this
                  card a dead end on any contract-bearing agent. */}
              <AgentActions
                slug={checklist.slug}
                name={checklist.name}
                isActive
                requiresLocal={checklist.requiresLocal}
                setupRouteClass={checklist.setupContext?.requiredRouteClass ?? null}
                source={checklist.source}
                pendingQuestions={checklist.pendingQuestions ?? 0}
                blockingQuestions={checklist.blockingQuestions}
                revisePending={revisePending}
                statusUnavailable={statusUnavailable}
                workflowVersionId={runInputs?.workflowVersionId ?? null}
                inputContract={runInputs?.inputContract ?? null}
                inputContractDigest={runInputs?.inputContractDigest ?? null}
                align="start"
              />
              {/* Granting/activating is itself the finished task — let the user
                  leave without feeling obliged to run it right now. Done is
                  SECONDARY (Run now above is primary) and must land on THIS
                  agent's own page, where Run now / Last output / schedule live —
                  never bounce to Home. router.back() used to return the user to
                  wherever they came from; in the desktop flow that's /overview,
                  a dead-end (founder: "lands on Home, clueless what's next"). */}
              <button
                type="button"
                onClick={() => router.push(`/workflows/${encodeURIComponent(checklist.slug)}?source=${encodeURIComponent(checklist.source || 'generated')}`)}
                className="text-ui text-ink-400 hover:text-ink-200 mt-2"
              >
                Done
              </button>
            </div>
          </div>
        ) : needsGrant ? (
          // Already active, but a Tier-2 capability still needs your deliberate OK.
          <>
            <button
              type="button"
              onClick={() => activate()}
              disabled={!allLocalGranted || activating}
              className={allLocalGranted && !activating ? 'btn-success' : 'btn-outline opacity-50 cursor-not-allowed'}
              title={allLocalGranted ? 'Save this grant' : 'Allow the permission above first'}
            >
              {activating ? 'Granting…' : 'Grant access'}
            </button>
            {error ? (
              <span className="text-secondary text-state-fail">{error}</span>
            ) : !allLocalGranted ? (
              <span className="text-secondary text-ink-500">Allow the highlighted permission above, then grant.</span>
            ) : null}
          </>
        ) : !allLocalGranted ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={allowFirstRequiredPermission}
              disabled={!!savingGroup}
              className="btn-outline border-amber-500/50 text-state-needs"
            >
              {firstMissingUsesSharedApproval ? 'Allow commands for my agents' : 'Allow required permission'}
            </button>
            <span className="text-secondary text-state-needs max-w-md leading-snug">
              {firstMissingUsesSharedApproval
                ? 'This lets agents on your Tukido account run commands when they need to. You can turn it off in Settings.'
                : 'This agent cannot deliver its final output without the highlighted permission. Grant it once to this agent, or leave the agent inactive.'}
            </span>
          </div>
        ) : !computerUseSatisfied ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                const button = document.querySelector<HTMLButtonElement>('[data-computer-use-setup]');
                button?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                button?.click();
              }}
              className="btn-outline border-amber-500/50 text-state-needs"
            >
              Set up required Mac access
            </button>
            <span className="text-secondary text-state-needs max-w-md leading-snug">This agent cannot deliver its final output without Screen Recording and Accessibility on this Mac. macOS will identify the requester as Tukido because it launches the local Codex runner.</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => activate(anyWorkedAround, forceOnDemand)}
              disabled={!ready || activating}
              className={ready && !activating ? 'btn-success' : 'btn-outline opacity-50 cursor-not-allowed'}
              title={ready ? 'Switch this agent on' : 'Finish the steps above first'}
            >
              {activating ? (guided ? 'Turning on…' : 'Activating…') : (setupSurface?'Finish setup':guided ? 'Turn it on' : 'Activate')}
            </button>
            {error ? (
              <span className="text-secondary text-state-fail">{error}</span>
            ) : !ready && unmetConns.length > 0 ? (
              <span className="text-secondary text-ink-500">Sign in above, or tick “let Claude figure out an alternative”.</span>
            ) : suggestedCadence ? (
              // Recurring agent → activates on its inferred clock by default, with a
              // one-tap opt-out to on-demand.
              <span className="text-secondary text-ink-500 basis-full">
                {forceOnDemand
                  ? <>Will run <span className="text-ink-200">on-demand</span> (only when you start it). <button type="button" onClick={() => setForceOnDemand(false)} className="text-action-accent hover:underline">Run {suggestedCadence} instead</button></>
                  : <>Will run <span className="text-ink-200">{suggestedCadence}</span> once on (change it in Schedule above). <button type="button" onClick={() => setForceOnDemand(true)} className="text-action-accent hover:underline">Run on-demand instead</button></>}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
