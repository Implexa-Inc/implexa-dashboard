'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Surface = 'cli' | 'desktop' | 'cowork';
type OS = 'mac' | 'windows' | 'linux' | 'unknown';

const SURFACES: Array<{ id: Surface; label: string; subtitle: string }> = [
  { id: 'cli',     label: 'Claude Code (CLI)',    subtitle: 'Terminal — full capture (tool calls + conversation turns)' },
  { id: 'cowork',  label: 'Cowork (web)',         subtitle: 'Plugin install — also auto-enables Desktop Chat' },
  { id: 'desktop', label: 'Claude Desktop chat',  subtitle: 'Just paste a Connector URL — 30 sec' },
];

const PLUGIN_INSTALL_CMD = `/plugin marketplace add https://github.com/Implexa-Inc/implexa-claude-plugin.git
/plugin install implexa@implexa`;

const SETUP_HOOKS_CMD = `curl -sL https://raw.githubusercontent.com/Implexa-Inc/implexa-claude-plugin/main/scripts/install-user-hooks.sh | bash`;

export default function InstallFlow({ hasKey, keyPrefix }: { hasKey: boolean; keyPrefix: string | null }) {
  const [surface, setSurface] = useState<Surface>('cli');
  // Default to 'unknown' so SSR + first client render match; the effect upgrades it.
  const [os, setOs] = useState<OS>('unknown');

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || '';
    const hay = `${ua} ${platform}`.toLowerCase();
    if (hay.includes('win')) {
      setOs('windows');
      // On Windows the bash hooks installer is broken — Desktop Connector works fully,
      // Cowork mostly works, CLI capture is degraded (no hooks). Default to Desktop.
      setSurface('desktop');
    } else if (hay.includes('mac') || hay.includes('darwin')) {
      setOs('mac');
    } else if (hay.includes('linux')) {
      setOs('linux');
    }
  }, []);

  // Hooks (Step 3) only fire reliably in Claude Code CLI on macOS. Confirmed via
  // fresh-Mac testing (2 machines): Cowork doesn't invoke ~/.claude/settings.json
  // hooks at all, and Desktop Chat has no plugin/hook system either.
  // The bash installer is also Mac-only (uses launchctl, brew, ~/Library paths),
  // so on Windows we hide the hooks step entirely.
  const showHooksStep = surface === 'cli' && os !== 'windows';
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
        {/* Surface tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {SURFACES.map((s) => {
            // CLI surface still selectable on Windows (plugin install + MCP work),
            // but we mark it as degraded so users see what's actually supported.
            const isDegradedOnWindows = isWindows && s.id === 'cli';
            const subtitle = isDegradedOnWindows
              ? 'Plugin + MCP work; hook capture not yet on Windows'
              : s.subtitle;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSurface(s.id)}
                className={`px-3 py-2 rounded-md text-sm transition-colors text-left ${
                  surface === s.id
                    ? 'bg-brand-500 text-ink-950 font-medium shadow-glow'
                    : 'bg-ink-800 text-ink-200 hover:bg-ink-700 border border-ink-700'
                } ${isDegradedOnWindows ? 'opacity-70' : ''}`}
              >
                <div className="font-medium flex items-center gap-1.5">
                  {s.label}
                  {isDegradedOnWindows && (
                    <span className="text-[9px] uppercase tracking-wider rounded px-1 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold">Beta</span>
                  )}
                </div>
                <div className={`text-[10px] mt-0.5 ${surface === s.id ? 'text-ink-950/70' : 'text-ink-400'}`}>{subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Surface-specific content */}
        <SurfaceContent surface={surface} hasKey={hasKey} />
      </Section>

      {/* ── Step 3 (CLI only): Setup hooks ───────────────────────────── */}
      {showHooksStep && (
        <Section
          number={3}
          title="Enable full capture (one-time)"
          subtitle="Optional but recommended — installs hooks that capture every prompt + assistant response into your demos. Without these, you still get tool-call capture via MCP, but conversation turns are skipped."
        >
          <div className="space-y-3">
            {/* Non-coder reassurance — most users on this page aren't developers */}
            <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-3 text-xs text-ink-200 leading-relaxed">
              <p className="font-medium text-ink-100 mb-1.5">Not a developer? You&apos;re fine.</p>
              <p className="mb-2">
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
            <p className="text-xs text-ink-300 leading-relaxed">
              Copy the command below, then open <strong>Terminal</strong>, paste it, and press Enter.
              <span className="block text-ink-400 mt-1">
                Don&apos;t have Terminal open? Press <strong>Cmd + Space</strong>, type <em>terminal</em>, press Enter.
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
            {surface === 'cli'
              ? <>Type <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/exit</code> to leave Claude Code, then run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">claude</code> in your terminal again so it picks up the new config.</>
              : surface === 'cowork'
              ? <>Fully quit Claude with <strong>Cmd+Q</strong> (not just close the window), then relaunch and open Cowork.</>
              : <>You don&apos;t need to restart for the Connector to work — but if it doesn&apos;t appear right away, try opening a new Desktop chat.</>}
          </p>
          {surface === 'desktop' ? (
            <p className="text-sm text-ink-200 leading-relaxed">
              Plugin slash commands like <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:setup</code> don&apos;t exist on Desktop Chat (plugins are only available in Cowork and Code). Instead, ask Claude in natural language:{' '}
              <em>&ldquo;Show me my Implexa plan&rdquo;</em> — Claude will call the <code className="text-xs">get_credits</code> MCP tool and confirm you&apos;re connected.
            </p>
          ) : (
            <p className="text-sm text-ink-200 leading-relaxed">
              Run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:setup</code> to verify you&apos;re connected, then{' '}
              <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:record-skill</code> to capture your first workflow.
            </p>
          )}
          {surface !== 'cli' && (
            <p className="text-xs text-ink-400 leading-relaxed">
              Note: on {surface === 'cowork' ? 'Cowork' : 'Desktop Chat'}, conversation-turn capture isn&apos;t available yet (Anthropic limitation — hooks don&apos;t fire here). You still get tool-call capture via MCP, which is the bulk of what&apos;s useful. For full conversation capture, use Claude Code (CLI).
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

function SurfaceContent({ surface, hasKey }: { surface: Surface; hasKey: boolean }) {
  const apiKeyHint = hasKey
    ? 'Your API key is in ~/.zshrc — the install script picks it up automatically.'
    : 'Generate an API key in Step 1 first.';

  if (surface === 'cli') {
    return (
      <>
        <p className="text-sm text-ink-200 mb-3 leading-relaxed">
          In your terminal, set your API key once, then install the plugin:
        </p>
        <CodeBlock
          code={`echo 'export IMPLEXA_API_KEY="<paste your imp_live_... key>"' >> ~/.zshrc
source ~/.zshrc`}
        />
        <p className="text-xs text-ink-400 mt-3 mb-3">
          Then launch Claude Code + install the plugin (run inside Claude Code):
        </p>
        <CodeBlock code={`claude\n\n${PLUGIN_INSTALL_CMD}`} />
        <p className="text-xs text-ink-400 mt-3 leading-relaxed">
          <strong>Plugin hooks fire natively in Claude Code CLI</strong> — this is the only surface today with full conversation-turn capture (the killer feature). Step 3 below installs them.
        </p>
      </>
    );
  }

  if (surface === 'desktop') {
    // The Connector URL template — user replaces YOUR_KEY with their actual key.
    // Anthropic's Custom Connector UI in Desktop accepts MCP-over-HTTPS endpoints,
    // and our backend already speaks the protocol at /api/v2/mcp.
    const connectorUrl = 'https://core.implexa.ai/api/v2/mcp?api_key=imp_live_YOUR_KEY';
    return (
      <>
        <div className="rounded-lg border border-success-400/40 bg-success-400/5 p-3 mb-3 text-xs text-ink-200 leading-relaxed">
          <p className="font-medium text-ink-100 mb-1">⚡ Fastest install — 30 seconds.</p>
          <p>
            Desktop Chat doesn&apos;t use plugins (those are Cowork/Code only). Instead, you add Implexa as a <strong>Custom Connector</strong> — a remote MCP server. Just paste one URL with your API key in it.
          </p>
        </div>
        <p className="text-sm text-ink-200 mb-3 leading-relaxed">
          Copy this URL and <strong>replace <code className="bg-ink-800 px-1 rounded text-xs">imp_live_YOUR_KEY</code> with your actual API key</strong> from Step 1:
        </p>
        <CodeBlock code={connectorUrl} oneLine />
        <p className="text-sm text-ink-200 mt-4 mb-3 leading-relaxed">Then in Claude Desktop:</p>
        <ol className="text-sm text-ink-200 mb-3 pl-5 space-y-1.5 list-decimal marker:text-ink-400">
          <li>Open a <strong>regular chat</strong> (not Cowork)</li>
          <li>Click <strong>+</strong> in the chat input area</li>
          <li>Hover <strong>Connectors</strong> → click <strong>Add connector</strong></li>
          <li>Paste your edited URL, hit <strong>Save</strong></li>
          <li>Toggle <strong>Implexa</strong> ON in the connector list</li>
        </ol>
        <details className="text-xs text-ink-300 mt-3">
          <summary className="cursor-pointer hover:text-ink-100 select-none">Already use Cowork? You probably don&apos;t need this step.</summary>
          <div className="mt-2 pl-4 leading-relaxed">
            <p>Installing the Implexa plugin via Cowork automatically registers the Custom Connector in Desktop Chat too. So if you&apos;ve already done the Cowork install (the previous tab), Implexa should already appear in your Desktop Connectors list as <em>Implexa CUSTOM</em>.</p>
          </div>
        </details>
        <details className="text-xs text-ink-300 mt-2">
          <summary className="cursor-pointer hover:text-ink-100 select-none">What does this connector give me?</summary>
          <div className="mt-2 pl-4 leading-relaxed space-y-1">
            <p>All 28 Implexa MCP tools — record-skill, list-org-skills, share-this, find-accounts, etc. — available via natural language in Desktop Chat.</p>
            <p>Slash commands like <code className="bg-ink-800 px-1 rounded text-[11px]">/implexa:setup</code> don&apos;t exist on Desktop (those require the plugin system). Instead, just ask Claude things like <em>&ldquo;Implexa, show my plan&rdquo;</em> or <em>&ldquo;Implexa, record this workflow&rdquo;</em>.</p>
          </div>
        </details>
      </>
    );
  }

  // cowork
  return (
    <>
      <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-3 mb-3 text-xs text-ink-200 leading-relaxed">
        <p className="font-medium text-ink-100 mb-1">✨ Bonus: this also enables Desktop Chat.</p>
        <p>
          Installing the Implexa plugin in Cowork automatically registers the Custom Connector in your Desktop Chat too — one install, both surfaces. No extra step for Desktop.
        </p>
      </div>
      <p className="text-sm text-ink-200 mb-3 leading-relaxed">
        Open Cowork in your browser, then in the left sidebar click <strong>Customize</strong>:
      </p>
      <ol className="text-sm text-ink-200 mb-3 pl-5 space-y-1.5 list-decimal marker:text-ink-400">
        <li>Scroll to the <strong>Personal plugins</strong> section</li>
        <li>
          Click <strong>+ Create plugin</strong>, then choose <strong>Add marketplace</strong>
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
      <details className="text-xs text-ink-300 mt-3">
        <summary className="cursor-pointer hover:text-ink-100 select-none">Why no hooks step for Cowork?</summary>
        <div className="mt-2 pl-4 leading-relaxed">
          <p>Anthropic&apos;s Cowork sandbox doesn&apos;t fire user-level hooks despite registering them. Tested on multiple fresh Macs — confirmed. So we&apos;ve removed the hooks installer step for Cowork to avoid wasting your time. You still get tool-call capture via MCP — just not conversation-turn capture. For full capture, use Claude Code CLI.</p>
        </div>
      </details>
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
