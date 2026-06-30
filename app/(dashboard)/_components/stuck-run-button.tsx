'use client';

type Engine = 'claude' | 'codex';
type DesktopBridge = {
  recoverEngineTask?: (context: { engine: Engine; threadId?: string | null; workspace?: string | null; runId?: string | null }) => Promise<{ ok?: boolean }>;
  openEnginePermissions?: (engine: Engine, capability?: string) => Promise<unknown>;
};
function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop || null;
}

const DISPATCHER_TASK_ID = 'implexa-browser-dispatcher';

export default function StuckRunButton({
  engine = 'claude', threadId, workspace, runId, claudeTaskId, permissionCapability, className = '',
}: {
  engine?: Engine | null; threadId?: string | null; workspace?: string | null; runId?: string | null;
  claudeTaskId?: string | null; permissionCapability?: 'browser' | 'computerUse' | null; className?: string;
}) {
  const selected: Engine = engine === 'codex' ? 'codex' : 'claude';
  const name = selected === 'codex' ? 'Codex' : 'Claude';
  const recoveryPrompt = `Continue the existing Implexa run ${runId || ''}. Load its saved run context and resume from the blocker.`;
  const href = selected === 'codex'
    ? (threadId ? `codex://threads/${encodeURIComponent(threadId)}` : `codex://threads/new?prompt=${encodeURIComponent(recoveryPrompt)}${workspace ? `&path=${encodeURIComponent(workspace)}` : ''}`)
    : `claude://claude.ai/claude-code-desktop/scheduled/${encodeURIComponent(claudeTaskId || DISPATCHER_TASK_ID)}`;

  async function recover() {
    const b = bridge();
    if (b?.recoverEngineTask) await b.recoverEngineTask({ engine: selected, threadId, workspace, runId });
    else window.location.href = href;
  }
  async function permissions() {
    const b = bridge();
    if (b?.openEnginePermissions) await b.openEnginePermissions(selected, permissionCapability || 'browser');
    else window.location.href = selected === 'codex'
      ? (permissionCapability === 'computerUse' ? 'codex://settings/computer-use/google-chrome' : 'codex://settings/browser-use')
      : 'claude://settings/permissions';
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={recover} className="btn-success text-xs px-3 py-1.5 inline-flex items-center gap-1 whitespace-nowrap">
          Open this task in {name} ↗
        </button>
        {permissionCapability && <button type="button" onClick={permissions} className="btn-outline text-xs px-3 py-1.5">Open {permissionCapability === 'computerUse' ? 'computer-use' : 'browser'} permissions</button>}
      </div>
      <p className="mt-1 text-[10.5px] text-ink-500 leading-snug">
        {threadId ? `Reopens the exact ${name} thread that ran this task.` : `If the original thread is gone, ${name} opens a recovery thread in the saved workspace.`}
      </p>
    </div>
  );
}
