'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Surface = 'code-desktop' | 'code-cli' | 'cowork' | 'chat-desktop';
type OS = 'mac' | 'windows' | 'linux' | 'unknown';

// Labels are kept short — section header already says "Install the plugin
// in Claude", so we drop the redundant "Claude" prefix on the tabs.
const SURFACES: Array<{ id: Surface; label: string; subtitle: string; recommended?: boolean }> = [
  { id: 'code-desktop', label: 'Code (Desktop)', subtitle: 'Plugin install via Customize — full capture with a visual install', recommended: true },
  { id: 'code-cli',     label: 'Code (CLI)',     subtitle: 'Terminal install — full capture for power users' },
  { id: 'cowork',       label: 'Cowork',         subtitle: 'Plugin install via Customize — MCP capture (hooks gap until Anthropic ships fix)' },
  { id: 'chat-desktop', label: 'Chat (Desktop)', subtitle: 'Custom Connector URL — 30 sec, no plugin install' },
];

const PLUGIN_INSTALL_CMD = `/plugin marketplace add https://github.com/Implexa-Inc/implexa-claude-plugin.git
/plugin install implexa@implexa`;

const SETUP_HOOKS_CMD = `curl -sL https://raw.githubusercontent.com/Implexa-Inc/implexa-claude-plugin/main/scripts/install-user-hooks.sh | bash`;

export default function InstallFlow({
  hasKey,
  keyPrefix,
  coworkHooksLive = false,
}: {
  hasKey:           boolean;
  keyPrefix:        string | null;
  /**
   * Set to true once we've observed at least one hook event arrive from a
   * Cowork user-agent — i.e. Anthropic shipped the Cowork hooks fix.
   * Flips the install-flow UX:
   *   - Cowork tab no longer shows "hooks don't fire" warnings
   *   - Hooks installer Step 3 is offered for Cowork too (currently CLI-only)
   *   - Verify step drops the "conversation-turn capture not available" caveat
   */
  coworkHooksLive?: boolean;
}) {
  // Default to Claude Code (Desktop): plugin install via Customize is the
  // most accessible path AND it supports full capture (hooks fire there).
  // CLI matches the same capability but is for power users; we let visitors
  // discover it via the second tab.
  const [surface, setSurface] = useState<Surface>('code-desktop');
  // Default to 'unknown' so SSR + first client render match; the effect upgrades it.
  const [os, setOs] = useState<OS>('unknown');

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || '';
    const hay = `${ua} ${platform}`.toLowerCase();
    if (hay.includes('win')) {
      setOs('windows');
      // On Windows the bash hooks installer doesn't work — so the only
      // path that fully works is Claude chat (Desktop) via Connector URL.
      // Claude Code (Desktop/CLI) install works but hook capture is broken.
      setSurface('chat-desktop');
    } else if (hay.includes('mac') || hay.includes('darwin')) {
      setOs('mac');
    } else if (hay.includes('linux')) {
      setOs('linux');
    }
  }, []);

  // Hooks (Step 3) fires reliably wherever Claude Code runs — both the
  // Desktop UI version and the CLI version. The user-level hooks installer
  // writes to ~/.claude/settings.json which both honor.
  //
  // Cowork (Desktop): Cowork historically did NOT invoke user-level hooks
  // (Anthropic platform issue). The platform_signals table flips this
  // automatically the moment we observe a hook event from a Cowork
  // user-agent (= Anthropic shipped the fix).
  //
  // Claude chat (Desktop): no plugin system at all (uses Custom Connector URL).
  //
  // Windows: the bash hooks installer doesn't work (launchctl + brew + macOS
  // paths). Hide the hooks step entirely until we ship a PowerShell installer.
  const showHooksStep = (
    surface === 'code-desktop' ||
    surface === 'code-cli' ||
    (surface === 'cowork' && coworkHooksLive)
  ) && os !== 'windows';
  const isWindows = os === 'windows';

  return (
    <>
      {/* ── Windows gate ─────────────────────────────────────────────── */}
      {/* Detected after mount, so SSR doesn't ship a Windows-specific banner
       * to all users. The banner is informational, not a hard block — Desktop
       * Connector + Cowork plugin both work on Windows. Only the CLI hooks
       * installer is Mac-only (bash + launchctl + brew). */}
      {isWindows && (
        <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none mt-0.5">⚠️</span>
            <div className="flex-1 text-sm">
              <p className="font-semibold text-ink-50 mb-1">Windows support is in beta</p>
              <p className="text-ink-200 leading-relaxed mb-2">
                Full Windows install support is coming soon. In the meantime, here&apos;s what works on Windows today:
              </p>
              <ul className="text-ink-200 space-y-1 list-disc pl-5 marker:text-amber-400/70">
                <li><strong>✅ Claude Desktop chat</strong> (Custom Connector URL) — works fully, 30-second setup.</li>
                <li><strong>✅ Cowork (web)</strong> — plugin install works; MCP tool capture works. Hook-based conversation-turn capture not available (same limitation as Mac).</li>
                <li><strong>⚠️ Claude Code (CLI)</strong> — plugin install works, but the hooks installer is currently bash-only (Mac/Linux). You can still use Implexa via MCP tools — just no automatic hook capture.</li>
              </ul>
              <p className="text-ink-300 text-xs mt-3 leading-relaxed">
                Want to be notified when the Windows installer ships?{' '}
                <a href="mailto:hello@implexa.ai?subject=Windows%20installer%20waitlist" className="text-brand-500 hover:underline">Email us</a>{' '}
                and we&apos;ll ping you.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 1: API key ──────────────────────────────────────────── */}
      <Section number={1} title="Get your API key" done={hasKey}>
        {hasKey ? (
          <div className="text-sm text-ink-200">
            ✓ You have an active API key (<code className="font-mono text-xs bg-ink-800 px-1.5 py-0.5 rounded">{keyPrefix}…</code>).
            Find the full key at{' '}
            <Link href="/settings/api-keys" className="text-brand-500 hover:underline">Settings → API keys</Link>.
          </div>
        ) : (
          <div>
            <p className="text-sm text-ink-200 mb-3">
              You&apos;ll need an API key (<code className="font-mono text-xs">imp_live_…</code>) so Claude can authenticate to Implexa.
            </p>
            <Link href="/settings/api-keys?next=/install" className="btn-primary">
              Generate an API key →
            </Link>
            <p className="text-xs text-ink-400 mt-2">
              We&apos;ll bring you right back here after you create the key.
            </p>
          </div>
        )}
      </Section>

      {/* ── Step 2: Pick surface + install plugin ────────────────────── */}
      <Section number={2} title="Install the plugin in Claude">
        {/* Surface tabs — compact underline pattern.
         *
         * Why not the previous 2x2 card grid: at 4 surfaces it became
         * visually heavy + the per-tab subtitle duplicated the surface
         * content callout that follows. Underline tabs are lightweight,
         * still convey active state clearly, and let the selected
         * surface's longer description live in a single line below. */}
        <div className="border-b border-ink-700 mt-6 mb-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2 -mb-px">
            {SURFACES.map((s) => {
              // Claude Code surfaces (Desktop + CLI) and Cowork still install
              // on Windows — plugin + MCP work. But the bash hooks installer
              // fails, so we mark these as Beta on Windows so users see what's
              // actually supported on their OS.
              const isDegradedOnWindows = isWindows && (s.id === 'code-desktop' || s.id === 'code-cli' || s.id === 'cowork');
              const isActive = surface === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSurface(s.id)}
                  className={`pb-3 px-1 -mb-px border-b-2 text-sm transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                    isActive
                      ? 'border-brand-500 text-ink-50 font-medium'
                      : 'border-transparent text-ink-400 hover:text-ink-200'
                  } ${isDegradedOnWindows ? 'opacity-70' : ''}`}
                >
                  <span>{s.label}</span>
                  {s.recommended && !isDegradedOnWindows && (
                    <span className="text-[10px] text-success-700 dark:text-success-400 font-medium">★ Recommended</span>
                  )}
                  {isDegradedOnWindows && (
                    <span className="text-[9px] uppercase tracking-wider rounded px-1 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold">Beta</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Single subtitle below tab strip — describes the selected surface.
         * Replaces the per-tab subtitle that lived inside each card. */}
        <p className="text-xs text-ink-400 mb-5 leading-relaxed">
          {(() => {
            const selected = SURFACES.find((s) => s.id === surface);
            const isDegraded = isWindows && (surface === 'code-desktop' || surface === 'code-cli' || surface === 'cowork');
            return isDegraded ? 'Plugin + MCP work; hook capture not yet on Windows.' : selected?.subtitle;
          })()}
        </p>

        {/* Surface-specific content */}
        <SurfaceContent surface={surface} hasKey={hasKey} coworkHooksLive={coworkHooksLive} />
      </Section>

      {/* ── Step 3 (CLI only): Setup hooks ───────────────────────────── */}
      {showHooksStep && (
        <Section
          number={3}
          title="Enable full capture (one more command)"
          subtitle="Do this — it's the difference between Implexa capturing tool calls only vs. tool calls + every prompt and assistant response. The latter is what makes the recorded skill actually replayable. You're already in a terminal — paste one command."
        >
          <div className="space-y-3">
            {/* Non-coder reassurance — collapsed by default so the step stays
             * clean for confident users. Same <details> pattern as the
             * "What does this script do?" block below for visual consistency. */}
            <details className="rounded-lg border border-ink-700 bg-ink-800/40 text-xs text-ink-200 leading-relaxed group">
              <summary className="cursor-pointer hover:bg-ink-800/60 transition-colors px-3 py-2 select-none flex items-center gap-1.5">
                <span className="text-ink-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                <span className="font-medium text-ink-100">Not a developer? You&apos;re fine — read this first.</span>
              </summary>
              <div className="px-3 pb-3 pt-1 border-t border-ink-700/60">
                <p className="mb-2 mt-2">
                  This is one safe command. The script handles everything — just answer{' '}
                  <code className="bg-ink-900 px-1 rounded">y</code> when prompted and paste your API key when it asks. It will:
                </p>
                <ol className="pl-4 list-decimal space-y-0.5 marker:text-ink-500">
                  <li>Install <strong>Homebrew</strong> if missing (Mac&apos;s standard package manager — common dev tool)</li>
                  <li>Install <strong>Node.js</strong> (common dev tool — needed by Implexa&apos;s MCP server)</li>
                  <li>Ask you to paste your API key (the one you copied above)</li>
                  <li>Configure Claude to capture skills</li>
                </ol>
                <p className="mt-2 text-ink-400">
                  Takes ~3–5 min the first time (mostly downloads), instant on re-runs. You may be asked for your Mac password once — that&apos;s normal for installing system tools.
                </p>
              </div>
            </details>
            <p className="text-xs text-ink-300 leading-relaxed">
              <strong className="text-ink-100">Run this in a regular terminal</strong> (not inside Claude Code). If Claude Code is still running from Step 2, type <code className="bg-ink-800 px-1 rounded">/exit</code> to leave it first, OR just open a new Terminal tab (<strong>Cmd + T</strong>).
              <span className="block text-ink-400 mt-1">
                Then paste the command below and press Enter.
              </span>
            </p>
            <CodeBlock code={SETUP_HOOKS_CMD} oneLine />
            <details className="text-xs text-ink-300">
              <summary className="cursor-pointer hover:text-ink-100 select-none">What exactly does this script do? (details)</summary>
              <div className="mt-2 pl-4 space-y-1 leading-relaxed">
                <p>• Installs <code className="text-[11px] bg-ink-800 px-1 rounded">jq</code> + <code className="text-[11px] bg-ink-800 px-1 rounded">Node.js</code> if missing (via Homebrew)</p>
                <p>• <strong>Prompts you to paste your API key</strong>, then stores it in <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/implexa.env</code> (chmod 600)</p>
                <p>• Writes a launcher at <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/implexa-hook.sh</code></p>
                <p>• Patches <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/settings.json</code> to register hooks (backs up the original)</p>
                <p>• Registers MCP server in <code className="text-[11px] bg-ink-800 px-1 rounded">claude_desktop_config.json</code> as a fallback path</p>
                <p>• Runs a smoke test to verify the chain works</p>
                <p>• Idempotent — safe to re-run anytime</p>
              </div>
            </details>
          </div>
        </Section>
      )}

      {/* ── Final step: Verify + record ──────────────────────────────── */}
      {/* Step number renumbers to 3 when the hooks step (Step 3, CLI-only)
       * is hidden, so non-CLI users see steps 1 → 2 → 3 sequentially. */}
      <Section number={showHooksStep ? 4 : 3} title="Verify + record your first skill">
        <div className="space-y-3">
          <p className="text-sm text-ink-200 leading-relaxed">
            {surface === 'code-cli'
              ? <>Type <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/exit</code> to leave Claude Code, then run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">claude</code> in your terminal again so it picks up the new config.</>
              : surface === 'code-desktop'
              ? <>Fully quit Claude Code with <strong>Cmd+Q</strong> (not just close the window), then relaunch.</>
              : surface === 'cowork'
              ? <>Fully quit Claude with <strong>Cmd+Q</strong> (not just close the window), then relaunch and open Cowork.</>
              : <>You don&apos;t need to restart for the Connector to work — but if it doesn&apos;t appear right away, try opening a new Desktop chat.</>}
          </p>
          {surface === 'chat-desktop' ? (
            <div className="text-sm text-ink-200 leading-relaxed space-y-3">
              <p>
                Plugin slash commands like <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:setup</code> don&apos;t exist on Desktop Chat (plugins are only available in Cowork and Code). Instead, you talk to Implexa in natural language — Claude will call the right MCP tool behind the scenes.
              </p>
              <div className="bg-ink-800/40 border border-ink-700 rounded-md p-3 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-400 mb-1">1. Verify the connection</p>
                  <p className="text-sm">Paste this into a new Desktop chat:</p>
                  <div className="mt-2 bg-ink-950 border border-ink-700 rounded px-3 py-2 text-xs font-mono text-ink-100">
                    Implexa, what plan am I on?
                  </div>
                  <p className="text-[11px] text-ink-400 mt-1.5">Claude will call <code className="text-[11px]">get_credits</code> and reply with your plan + remaining quota.</p>
                </div>
                <div className="border-t border-ink-800 pt-3">
                  <p className="text-xs uppercase tracking-wide text-ink-400 mb-1">2. Record your first workflow</p>
                  <p className="text-sm">When you&apos;re ready to capture a workflow, say:</p>
                  <div className="mt-2 bg-ink-950 border border-ink-700 rounded px-3 py-2 text-xs font-mono text-ink-100">
                    Implexa, start recording. I want to capture how I research a company before a sales call.
                  </div>
                  <p className="text-[11px] text-ink-400 mt-1.5">Claude calls <code className="text-[11px]">start_demonstration</code>, then runs your workflow alongside you, and finally synthesizes a SKILL.md when you say &ldquo;Implexa, stop recording.&rdquo;</p>
                </div>
              </div>
              <p className="text-xs text-ink-400">
                If &ldquo;Implexa&rdquo; doesn&apos;t respond, the Connector toggle isn&apos;t ON. Click <strong>+</strong> in the chat input → Connectors → toggle <strong>Implexa</strong> ON.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-200 leading-relaxed">
              Run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:setup</code> to verify you&apos;re connected, then{' '}
              <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:record-skill</code> to capture your first workflow.
            </p>
          )}
          {/* Capture-degraded warning: only fires for Cowork (until Anthropic
           * fixes hooks) and Claude chat (no hook system). Claude Code (Desktop)
           * and CLI both get full capture. */}
          {(surface === 'cowork' && !coworkHooksLive) && (
            <p className="text-xs text-ink-400 leading-relaxed">
              Note: on Cowork, conversation-turn capture isn&apos;t available yet (Anthropic limitation — hooks don&apos;t fire here). You still get tool-call capture via MCP, which is the bulk of what&apos;s useful. For full conversation capture, switch to Claude Code (Desktop or CLI).
            </p>
          )}
          {surface === 'chat-desktop' && (
            <p className="text-xs text-ink-400 leading-relaxed">
              Note: Claude chat (Desktop) has no plugin/hook system — only MCP tool calls are captured (not your prompts or Claude&apos;s replies). For full conversation capture, switch to Claude Code (Desktop or CLI).
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/skills" className="btn-primary">Browse your skills →</Link>
            <Link href="/integrations" className="btn-outline">See what works with Implexa →</Link>
          </div>
        </div>
      </Section>
    </>
  );
}

function SurfaceContent({ surface, hasKey, coworkHooksLive }: { surface: Surface; hasKey: boolean; coworkHooksLive: boolean }) {
  const apiKeyHint = hasKey
    ? 'Your API key is in ~/.zshrc — the install script picks it up automatically.'
    : 'Generate an API key in Step 1 first.';

  // ── Claude Code (Desktop) ─────────────────────────────────────────
  // Visual install via Customize → Personal plugins. Same full-capture
  // capability as the CLI version, but easier for non-terminal users.
  if (surface === 'code-desktop') {
    return (
      <>
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-3 mb-4 text-xs text-ink-200 leading-relaxed">
          <p className="font-medium text-ink-100 mb-1">⭐ Easiest path — full capture with a visual install.</p>
          <p>
            Plugin install via the Customize panel inside Claude Code (Desktop). Same hook-based capture as the CLI version, but with a UI you click through instead of terminal commands.
          </p>
        </div>

        <p className="text-sm text-ink-200 mb-2 leading-relaxed">
          <strong className="text-ink-50">A.</strong> Open <strong>Claude Code</strong> on your Mac (the visual app, not the terminal command).
        </p>

        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">B.</strong> Click{' '}
          <HoverImageHint src="/img/install/customize.png" alt="The Customize button in the Claude Code sidebar">
            <strong>Customize</strong>
          </HoverImageHint>
          {' '}in the sidebar → scroll to <strong>Personal plugins</strong>.
        </p>

        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">C.</strong> Click{' '}
          <HoverImageHint
            src="/img/install/create-plugin.png"
            alt="The + Create plugin → Add marketplace menu in Personal plugins"
            width="w-[520px]"
          >
            <strong>+ Create plugin</strong>
          </HoverImageHint>
          {' '}→ choose <strong>Add marketplace</strong> (not &ldquo;Create with Claude&rdquo; — that opens a chat to build a new plugin from scratch).
        </p>
        <CodeBlock code="https://github.com/Implexa-Inc/implexa-claude-plugin" oneLine />

        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">D.</strong> You land on the <strong>Directory</strong> page. Under the <strong>Personal</strong> tab, find the <strong>Implexa</strong> tile and click to install.
        </p>

        <p className="text-xs text-ink-400 mt-4 leading-relaxed">
          You don&apos;t need to paste your API key for this step — the plugin pulls it from your account when Claude Code talks to Implexa.
        </p>

        <p className="text-xs text-ink-400 mt-4 leading-relaxed border-t border-ink-800 pt-3">
          <strong className="text-ink-200">Why this gets full capture:</strong> the Customize panel writes the plugin to your local config which Claude Code Desktop honors for both MCP tool calls AND user-level hooks (the conversation-turn capture path). Step 3 below installs those hooks.
        </p>
      </>
    );
  }

  // ── Claude Code (CLI) ─────────────────────────────────────────────
  if (surface === 'code-cli') {
    return (
      <>
        {/* Disambiguation callout — users frequently confuse Claude Code (CLI)
         * with the Claude chat app. These are different products and the slash
         * commands below ONLY work in the CLI. */}
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-3 mb-4 text-xs text-ink-200 leading-relaxed">
          <p className="font-medium text-ink-100 mb-1">💡 Quick clarification</p>
          <p>
            <strong>Claude Code (CLI)</strong> is the terminal version of Claude Code (you also have the visual Desktop app — see the previous tab). It runs in your <strong>terminal</strong>, not in a chat window. The <code className="bg-ink-900 px-1 rounded">/plugin</code> commands below only work inside Claude Code CLI — they won&apos;t work if you paste them into Claude chat (Desktop).
          </p>
        </div>

        {/* Step A — set API key in terminal */}
        <p className="text-sm text-ink-200 mb-2 leading-relaxed">
          <strong className="text-ink-50">A.</strong> Open <strong>Terminal</strong> on your Mac (<em>Cmd+Space</em>, type <em>terminal</em>, Enter). Then paste this to save your API key:
        </p>
        <CodeBlock
          code={`echo 'export IMPLEXA_API_KEY="<paste your imp_live_... key>"' >> ~/.zshrc
source ~/.zshrc`}
        />

        {/* Step B — launch Claude Code */}
        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">B.</strong> In the same terminal, launch Claude Code by typing <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">claude</code> and pressing Enter. You&apos;ll see Claude Code start up — this is its own interactive session (you&apos;ll see a prompt like <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">{'>'}</code>).
        </p>

        {/* Step C — install plugin inside Claude Code */}
        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">C.</strong> Now you&apos;re <em>inside Claude Code</em>. Type these two commands (one at a time, hit Enter after each):
        </p>
        <CodeBlock code={PLUGIN_INSTALL_CMD} />
        <p className="text-[11px] text-ink-400 mt-2 leading-relaxed">
          You&apos;ll see Claude Code confirm each command (<em>&ldquo;Added marketplace…&rdquo;</em>, <em>&ldquo;Installed implexa…&rdquo;</em>). If you get a permission prompt, choose <strong>Allow</strong>.
        </p>

        <p className="text-xs text-ink-400 mt-4 leading-relaxed border-t border-ink-800 pt-3">
          <strong className="text-ink-200">Why Claude Code CLI is the best surface:</strong> plugin hooks fire natively here — this is the only surface today with full conversation-turn capture (the killer feature). Step 3 below installs those hooks.
        </p>
      </>
    );
  }

  // ── Claude chat (Desktop) ─────────────────────────────────────────
  // No plugin system. Custom Connector URL is the install. MCP-only capture.
  // Actual flow (confirmed via launch testing):
  //   1. Chat tab → Customize (sidebar)
  //   2. Customize panel → Connectors (left rail) → + → Add custom connector
  //   3. Modal: Name = "Implexa", Remote MCP server URL = our endpoint
  // The previous copy referenced "+ in chat input → Connectors → Add connector"
  // which is wrong — that flyout only shows already-installed connectors.
  if (surface === 'chat-desktop') {
    const connectorUrl = 'https://core.implexa.ai/api/v2/mcp?api_key=imp_live_YOUR_KEY';
    return (
      <>
        <div className="rounded-lg border border-success-400/40 bg-success-400/5 p-3 mb-3 text-xs text-ink-200 leading-relaxed">
          <p className="font-medium text-ink-100 mb-1">⚡ Fastest install — under a minute.</p>
          <p>
            Claude chat (Desktop) doesn&apos;t use plugins (those are Cowork + Claude Code only). Instead, you add Implexa as a <strong>Custom Connector</strong> — a remote MCP server. Just paste one URL with your API key in it.
          </p>
        </div>

        <p className="text-sm text-ink-200 mb-2 leading-relaxed">
          Copy this URL first and <strong>replace <code className="bg-ink-800 px-1 rounded text-xs">imp_live_YOUR_KEY</code> with your actual API key</strong> from Step 1 — you&apos;ll paste it in Step C below:
        </p>
        <CodeBlock code={connectorUrl} oneLine />

        <p className="text-sm text-ink-200 mt-5 mb-2 leading-relaxed">
          <strong className="text-ink-50">A.</strong> Open <strong>Claude Desktop</strong>, switch to the <strong>Chat</strong> tab, then click{' '}
          <HoverImageHint src="/img/install/chat-customize.png" alt="The Customize button in the Chat sidebar">
            <strong>Customize</strong>
          </HoverImageHint>
          {' '}in the sidebar.
        </p>

        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">B.</strong> In the Customize panel, click <strong>Connectors</strong> in the left rail, then click the{' '}
          <HoverImageHint
            src="/img/install/chat-connectors.png"
            alt="Connectors panel — the + button at the top right opens the Add custom connector menu"
            width="w-[520px]"
          >
            <strong>+</strong> button (top right) → <strong>Add custom connector</strong>
          </HoverImageHint>.
        </p>

        <p className="text-sm text-ink-200 mt-4 mb-2 leading-relaxed">
          <strong className="text-ink-50">C.</strong> In the{' '}
          <HoverImageHint
            src="/img/install/chat-custom-connector.png"
            alt="Add custom connector modal — Name field + Remote MCP server URL field"
            width="w-[520px]"
          >
            <strong>Add custom connector</strong> dialog
          </HoverImageHint>:
        </p>
        <ul className="text-sm text-ink-200 mb-3 pl-5 space-y-1.5 list-disc marker:text-ink-500">
          <li><strong>Name:</strong> type <code className="bg-ink-800 px-1 rounded text-xs">Implexa</code></li>
          <li><strong>Remote MCP server URL:</strong> paste the URL you edited above</li>
          <li>Click <strong>Add</strong>.</li>
        </ul>

        <p className="text-xs text-ink-400 mt-4 leading-relaxed">
          Done — Implexa is now available across all your Claude chats. Try it with{' '}
          <em className="text-ink-200">&ldquo;Implexa, show my plan&rdquo;</em> or{' '}
          <em className="text-ink-200">&ldquo;Implexa, record this workflow&rdquo;</em>.
        </p>

        <details className="text-xs text-ink-300 mt-4">
          <summary className="cursor-pointer hover:text-ink-100 select-none">Already use Cowork? You probably don&apos;t need this.</summary>
          <div className="mt-2 pl-4 leading-relaxed">
            <p>Installing the Implexa plugin via Cowork automatically registers a matching Custom Connector in Claude chat. Check Customize → Connectors first — Implexa may already be there as <em>Implexa</em>.</p>
          </div>
        </details>
        <details className="text-xs text-ink-300 mt-2">
          <summary className="cursor-pointer hover:text-ink-100 select-none">What does this connector give me?</summary>
          <div className="mt-2 pl-4 leading-relaxed space-y-1">
            <p>All Implexa MCP tools — record-skill, list-org-skills, share-this, find-accounts, etc. — available via natural language in Claude chat.</p>
            <p>Slash commands like <code className="bg-ink-800 px-1 rounded text-[11px]">/implexa:run</code> don&apos;t exist here (those require the plugin system). Instead, just ask Claude things like <em>&ldquo;Implexa, run my triage skill&rdquo;</em> or <em>&ldquo;Implexa, record this workflow&rdquo;</em>.</p>
          </div>
        </details>
      </>
    );
  }

  // ── Cowork (Desktop) ──────────────────────────────────────────────
  // Plugin install via Customize panel. Hooks gap is conditional on the
  // platform_signals.cowork_hooks_active flag (auto-flips when Anthropic
  // ships the fix and we observe a Cowork-sourced hook event).
  return (
    <>
      <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-3 mb-3 text-xs text-ink-200 leading-relaxed">
        <p className="font-medium text-ink-100 mb-1">✨ Bonus: this also enables Claude chat.</p>
        <p>
          Installing the Implexa plugin in Cowork automatically registers the Custom Connector in your Claude chat (Desktop) too — one install, both surfaces. No extra step for Claude chat.
        </p>
      </div>
      <p className="text-sm text-ink-200 mb-3 leading-relaxed">
        Open the Claude Desktop app and switch to <strong>Cowork</strong>, then in the left sidebar click{' '}
        <HoverImageHint src="/img/install/customize.png" alt="The Customize button in the Claude Code sidebar — same UI in Cowork">
          <strong>Customize</strong>
        </HoverImageHint>:
      </p>
      <ol className="text-sm text-ink-200 mb-3 pl-5 space-y-1.5 list-decimal marker:text-ink-400">
        <li>Scroll to the <strong>Personal plugins</strong> section</li>
        <li>
          Click{' '}
          <HoverImageHint
            src="/img/install/create-plugin.png"
            alt="The + Create plugin → Add marketplace menu — same UI as Code (Desktop)"
            width="w-[520px]"
          >
            <strong>+ Create plugin</strong>
          </HoverImageHint>
          , then choose <strong>Add marketplace</strong>
          <span className="block text-xs text-ink-400 mt-0.5">
            ⚠ Don&apos;t click <em>&ldquo;Create with Claude&rdquo;</em> — that opens a chat to build a new plugin from scratch.
          </span>
        </li>
        <li>Paste this URL:</li>
      </ol>
      <CodeBlock code="https://github.com/Implexa-Inc/implexa-claude-plugin" oneLine />
      <ol className="text-sm text-ink-200 mt-3 pl-5 space-y-1.5 list-decimal marker:text-ink-400" start={4}>
        <li>You&apos;ll land on the <strong>Directory</strong> page. Under the <strong>Personal</strong> tab, find the <strong>Implexa</strong> plugin tile and click it to install.</li>
      </ol>
      <p className="text-xs text-ink-400 mt-3 leading-relaxed">
        You do <strong>not</strong> need your API key for this step. The plugin pulls it from your account.
      </p>
      {coworkHooksLive ? (
        // Anthropic shipped the Cowork hooks fix — we've now observed at
        // least one hook event arrive from a Cowork user-agent. Surface
        // a celebratory note + tell users to run Step 3 below to enable
        // full capture on Cowork too.
        <div className="rounded-lg border border-success-400/40 bg-success-400/5 p-3 mt-3 text-xs text-ink-200 leading-relaxed">
          <p className="font-medium text-success-700 dark:text-success-400 mb-1">🎉 Cowork now supports hooks.</p>
          <p>
            Anthropic shipped the fix — conversation-turn capture now works on Cowork too. Run Step 3 below to install the hooks (or skip if you&apos;ve already done it for CLI; same script).
          </p>
        </div>
      ) : (
        <details className="text-xs text-ink-300 mt-3">
          <summary className="cursor-pointer hover:text-ink-100 select-none">Why no hooks step for Cowork?</summary>
          <div className="mt-2 pl-4 leading-relaxed">
            <p>Anthropic&apos;s Cowork sandbox doesn&apos;t fire user-level hooks despite registering them. Tested on multiple fresh Macs — confirmed. So we&apos;ve removed the hooks installer step for Cowork to avoid wasting your time. You still get tool-call capture via MCP — just not conversation-turn capture. For full capture, use Claude Code CLI.</p>
            <p className="mt-2 text-ink-400">We&apos;ll detect the moment Anthropic ships the fix and update this page automatically.</p>
          </div>
        </details>
      )}
    </>
  );
}

function Section({ number, title, subtitle, children, done, required }: { number: number; title: string; subtitle?: string; children: React.ReactNode; done?: boolean; required?: boolean }) {
  // Visual priority: done > required > default. A completed step never looks
  // "required" — green wins. The required state is only meaningful before
  // it's been actioned, so it should never compete with the done indicator.
  const cardBorder = done
    ? '!border-success-400/40'
    : required
      ? '!border-red-500/60'
      : '';
  const circle = done
    ? 'border-success-400 text-success-700 dark:text-success-400'
    : required
      ? 'border-red-500 text-red-600 dark:text-red-400'
      : 'border-brand-500 text-brand-500';
  const subtitleColor = done
    ? 'text-ink-300'
    : required
      ? 'text-red-600 dark:text-red-400 font-medium'
      : 'text-ink-300';

  return (
    <section className="mb-6">
      <div className={`card relative ${cardBorder}`}>
        <div className={`absolute -top-2.5 -left-2.5 w-7 h-7 rounded-full bg-ink-950 border-2 flex items-center justify-center text-xs font-bold ${circle}`}>
          {done ? '✓' : number}
        </div>
        <div className="pl-2">
          <h2 className="text-base font-medium text-ink-50 mb-1 flex items-center gap-2">
            {title}
            {done && <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">Done</span>}
            {!done && required && <span className="text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-red-500/15 text-red-600 dark:text-red-400">Required</span>}
          </h2>
          {subtitle && <p className={`text-xs mb-3 leading-relaxed ${subtitleColor}`}>{subtitle}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Inline word/phrase with a screenshot popover on hover — used in the
 * Code (Desktop) install steps to show users exactly where each button
 * lives in the Claude Code UI. The trigger word gets a dotted underline
 * + help cursor so people know to hover.
 *
 * On touch devices (no hover), the underline still hints at additional
 * context. We could add a click-to-toggle behaviour later if needed,
 * but for launch the hover-only pattern is enough — most users on the
 * install page are on a Mac with a pointer.
 *
 * Image files live in /public/img/install/ — see footnote at the
 * bottom of this file for the expected paths.
 */
function HoverImageHint({
  children,
  src,
  alt,
  width = 'w-96',
}: {
  children: React.ReactNode;
  src: string;
  alt: string;
  /**
   * Tailwind width class for the popover. Default w-96 (384px) reads well
   * for typical 2:1-ish screenshots. Override to w-[480px] or larger when
   * the image is text-heavy or has nested panels — making the source pixels
   * crisp at the display size is what kills graininess.
   */
  width?: string;
}) {
  return (
    <span className="group relative inline cursor-help underline decoration-dotted decoration-ink-500 underline-offset-2">
      {children}
      <span className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 pointer-events-none">
        {/* Plain <img> not <Image> — these are static UI screenshots and we
         * want zero loader chrome / overhead. max-w-[90vw] keeps the popover
         * inside the viewport on narrow screens. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={`${width} max-w-[90vw] rounded-md shadow-2xl border border-ink-700 bg-ink-950`}
        />
      </span>
    </span>
  );
}

function CodeBlock({ code, oneLine = false }: { code: string; oneLine?: boolean }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="relative group">
      <pre className={`bg-ink-950 border border-ink-700 rounded-md p-3 text-xs text-ink-100 font-mono ${oneLine ? 'overflow-x-auto whitespace-nowrap' : 'whitespace-pre-wrap'} pr-12`}>{code}</pre>
      <button
        type="button"
        onClick={copy}
        className={`absolute top-2 right-2 text-[10px] uppercase tracking-wider font-medium rounded px-2 py-1 transition-colors ${
          copied
            ? 'bg-success-400/20 text-success-700 dark:text-success-400'
            : 'bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-ink-100 opacity-70 group-hover:opacity-100'
        }`}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}
