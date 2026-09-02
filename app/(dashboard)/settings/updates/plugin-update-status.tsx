'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CopyText from '../../_components/copy-text';

type Bridge = {
  pluginVersions?: () => Promise<Record<string, string | null>>;
  runUpdate?: (surface: string) => Promise<{ ok: boolean }>;
};

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: Bridge }).implexaDesktop || null;
}

function cmpVersion(a: string, b: string): number {
  const left = a.split('.').map((value) => parseInt(value, 10) || 0);
  const right = b.split('.').map((value) => parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export default function PluginUpdateStatus({ latest, surfaces, updateCommand, notes, changelogUrl }: {
  latest: string;
  surfaces?: Record<string, string>;
  updateCommand: string;
  notes: string | null;
  changelogUrl: string | null;
}) {
  const [installed, setInstalled] = useState<Record<string, string | null> | null>(null);
  const [checked, setChecked] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const refresh = async () => {
    const native = bridge();
    if (!native?.pluginVersions) { setChecked(true); return; }
    try { setInstalled(await native.pluginVersions()); }
    catch { setInstalled(null); }
    finally { setChecked(true); }
  };

  useEffect(() => { void refresh(); }, []);
  const rows = (['claude', 'codex'] as const).map((surface) => {
    const current = installed?.[surface] || null;
    const target = surfaces?.[surface] || latest;
    const behind = !!current && !!target && cmpVersion(current, target) < 0;
    return { surface, label: surface === 'claude' ? 'Claude' : 'Codex', current, target, behind };
  });
  const behind = rows.filter((row) => row.behind);
  const known = rows.filter((row) => row.current);

  const update = async (surface: string) => {
    const native = bridge();
    if (!native?.runUpdate) return;
    setRunning(surface);
    try { await native.runUpdate(surface); }
    finally { setRunning(null); await refresh(); }
  };

  return (
    <section className="card mb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="text-2xl shrink-0" aria-hidden="true">⚡</div>
          <div className="min-w-0">
            <div className="font-medium text-ink-50">Implexa plugin</div>
            <div className="text-xs text-ink-300 mt-0.5">Installed separately for Claude and Codex on each Mac.</div>
            {notes ? <div className="text-xs text-ink-400 mt-2 leading-relaxed">{notes}</div> : null}
          </div>
        </div>
        {checked && known.length > 0 && behind.length === 0 ? (
          <span className="text-[11px] font-semibold uppercase tracking-wider rounded px-2 py-1 bg-emerald-400/15 text-emerald-600 dark:text-emerald-300 border border-emerald-400/30">✓ Installed surfaces current</span>
        ) : checked && behind.length ? (
          <span className="text-[11px] font-semibold uppercase tracking-wider rounded px-2 py-1 bg-amber-400/15 text-amber-600 dark:text-amber-300 border border-amber-400/30">Update available</span>
        ) : null}
      </div>

      {installed ? (
        <div className="mt-4 space-y-2">
          {rows.map((row) => <div key={row.surface} className="rounded-lg border border-ink-800 bg-ink-900/40 p-3 flex items-center justify-between gap-3">
            <div className="text-xs"><span className="text-ink-100 font-medium">{row.label}</span><span className="text-ink-400 ml-2">{row.current ? `v${row.current}` : 'Not installed'}{row.target ? ` · latest v${row.target}` : ''}</span></div>
            {row.behind && bridge()?.runUpdate ? <button className="btn-primary text-xs px-3 py-1.5" disabled={!!running} onClick={() => void update(row.surface)}>{running === row.surface ? 'Updating…' : 'Update'}</button> : null}
          </div>)}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900/40 p-3 text-xs text-ink-300">
          {checked ? 'Open this page in the Implexa desktop app to verify versions on this Mac.' : 'Checking versions on this Mac…'}
          {latest ? ` Latest published plugin: v${latest}.` : ''}
        </div>
      )}

      <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">Manual reinstall</div>
        <div className="flex items-center justify-between gap-3">
          <code className="text-xs text-ink-100 font-mono truncate">{updateCommand}</code>
          <CopyText value={updateCommand} label="copy update command" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs">
        <Link href="/settings/engines" className="text-brand-500 hover:underline">Manage AI engines →</Link>
        {changelogUrl ? <a href={changelogUrl} target="_blank" rel="noreferrer" className="text-ink-400 hover:underline">What changed →</a> : null}
      </div>
    </section>
  );
}
