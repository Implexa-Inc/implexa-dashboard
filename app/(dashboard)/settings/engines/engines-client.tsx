'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type EngineReport = {
  engine: 'claude' | 'codex'; machine_id: string; app_installed: boolean; cli_installed: boolean;
  authenticated: boolean; plugin_connected: boolean; healthy: boolean; plugin_version?: string | null;
  latest_plugin_version?: string | null; plan_type?: string | null; capabilities?: Record<string, boolean>;
  usage_snapshot?: { primary?: { usedPercent?: number; windowMinutes?: number; resetsAt?: string }; secondary?: { usedPercent?: number; windowMinutes?: number; resetsAt?: string } };
  usage_confidence?: 'authoritative' | 'estimated' | 'unknown'; last_connection_at?: string | null;
  last_successful_run_at?: string | null; last_seen_at?: string | null;
};

type DesktopBridge = {
  runUpdate?: (engine: string) => unknown; openEngine?: (engine: string) => unknown;
  openEnginePermissions?: (engine: string, capability?: string) => unknown;
  openEngineAutomations?: (engine: string) => unknown;
  handoffAgent?: (prompt: string, engine: string, target: string) => unknown;
};
function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop || null;
}
function newestByEngine(reports: EngineReport[]) {
  const out = new Map<string, EngineReport>();
  for (const report of reports) if (!out.has(report.engine)) out.set(report.engine, report);
  return out;
}
function when(value?: string | null) {
  if (!value) return 'Never';
  const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString();
}
function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`text-[11px] rounded-full border px-2 py-0.5 ${ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-ink-700 text-ink-400'}`}>{ok ? '✓ ' : ''}{children}</span>;
}

export default function EnginesClient({ reports }: { reports: EngineReport[] }) {
  const rows = useMemo(() => newestByEngine(reports), [reports]);
  return <div className="grid lg:grid-cols-2 gap-5">{(['claude', 'codex'] as const).map((engine) => <EngineCard key={engine} engine={engine} report={rows.get(engine) || null} />)}</div>;
}

function EngineCard({ engine, report }: { engine: 'claude' | 'codex'; report: EngineReport | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const name = engine === 'claude' ? 'Claude' : 'Codex';
  const caps = report?.capabilities || {};
  const usage = report?.usage_snapshot?.primary;
  const confidence = report?.usage_confidence || 'unknown';
  const act = async (key: string, fn: (b: DesktopBridge) => Promise<unknown> | unknown) => {
    const native = bridge();
    const fallback: DesktopBridge = {
      runUpdate: () => { window.location.href = `/install?surface=${engine}`; },
      openEngine: () => { window.location.href = engine === 'codex' ? 'codex://threads/new' : 'claude://code/new'; },
      openEnginePermissions: () => { window.location.href = engine === 'codex' ? 'codex://settings/browser-use' : 'claude://settings/permissions'; },
      openEngineAutomations: () => { window.location.href = engine === 'codex' ? 'codex://automations' : 'claude://claude.ai/claude-code-desktop/scheduled'; },
      handoffAgent: (prompt) => { window.location.href = engine === 'codex' ? `codex://threads/new?prompt=${encodeURIComponent(prompt)}` : `claude://code/new?q=${encodeURIComponent(prompt)}`; },
    };
    setBusy(key); try { await fn(native || fallback); } finally { setBusy(null); }
  };
  const testPrompt = `Test my Implexa connection in ${name}. Call get_pending_run_requests only to verify MCP access—do not execute pending work—then call report_execution_engine for ${engine} with the capabilities you actually have. Reply with one short status line.`;
  return (
    <section className={`card border ${report?.healthy ? 'border-emerald-500/30' : 'border-ink-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-ink-50">{name}</h2><p className="text-xs text-ink-400 mt-0.5">{report?.healthy ? 'Ready to run Implexa agents' : 'Not fully connected'}</p></div>
        <Badge ok={!!report?.healthy}>{report?.healthy ? 'Ready' : 'Setup needed'}</Badge>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Badge ok={!!report?.app_installed}>Desktop app</Badge><Badge ok={!!report?.cli_installed}>CLI</Badge>
        <Badge ok={!!report?.authenticated}>Authentication</Badge><Badge ok={!!report?.plugin_connected}>Implexa plugin</Badge>
      </div>

      <dl className="mt-5 space-y-2 text-xs">
        <Row label="Plan" value={report?.plan_type || 'Unknown'} />
        <Row label="Plugin" value={`${report?.plugin_version ? `v${report.plugin_version}` : 'Unknown'}${report?.latest_plugin_version ? ` · latest v${report.latest_plugin_version}` : ''}`} />
        <Row label="Usage/headroom" value={usage?.usedPercent != null ? `${Math.max(0, 100 - usage.usedPercent)}% remaining (${confidence})` : `Unknown (${confidence})`} />
        <Row label="Usage source" value={confidence === 'authoritative' ? (engine === 'codex' ? 'Local Codex rate-limit event' : 'Vendor telemetry') : confidence === 'estimated' ? 'Recent Implexa-owned runs' : 'Not available'} />
        <Row label="Last connection" value={when(report?.last_connection_at)} />
        <Row label="Last successful run" value={when(report?.last_successful_run_at)} />
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        {!report?.plugin_connected && <Link href={`/install?surface=${engine}`} className="btn-primary text-xs px-3 py-1.5">Install</Link>}
        {report?.plugin_connected && report.latest_plugin_version && report.plugin_version !== report.latest_plugin_version && <button className="btn-primary text-xs px-3 py-1.5" disabled={!!busy} onClick={() => act('update', (b) => b.runUpdate?.(engine))}>{busy === 'update' ? 'Updating…' : 'Update'}</button>}
        <button className="btn-outline text-xs px-3 py-1.5" onClick={() => act('test', (b) => b.handoffAgent?.(testPrompt, engine, 'code'))}>Test</button>
        <button className="btn-outline text-xs px-3 py-1.5" onClick={() => act('reconnect', (b) => b.handoffAgent?.(testPrompt, engine, 'code'))}>Reconnect</button>
        <button className="btn-outline text-xs px-3 py-1.5" onClick={() => act('open', (b) => b.openEngine?.(engine))}>Open app</button>
        <button className="btn-outline text-xs px-3 py-1.5" onClick={() => act('permissions', (b) => b.openEnginePermissions?.(engine, caps.computerUse ? 'browser' : 'computerUse'))}>Permissions</button>
        {caps.automation && <button className="btn-outline text-xs px-3 py-1.5" onClick={() => act('automations', (b) => b.openEngineAutomations?.(engine))}>Automations</button>}
      </div>

      <div className="mt-4 pt-4 border-t border-ink-800 flex flex-wrap gap-2 text-[11px] text-ink-400">
        <span>Capabilities:</span>{['browser', 'computerUse', 'automation', 'headless'].map((cap) => <span key={cap} className={caps[cap] ? 'text-emerald-400' : 'text-ink-600'}>{cap === 'computerUse' ? 'computer use' : cap}</span>)}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-500">{label}</dt><dd className="text-ink-200 text-right">{value}</dd></div>;
}
