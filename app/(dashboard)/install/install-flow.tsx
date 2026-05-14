'use client';

import { useState } from 'react';
import Link from 'next/link';

type Surface = 'cli' | 'desktop' | 'cowork';

const SURFACES: Array<{ id: Surface; label: string; subtitle: string }> = [
  { id: 'cli',     label: 'Claude Code (CLI)', subtitle: 'Terminal — full features, native hooks' },
  { id: 'desktop', label: 'Claude Desktop',    subtitle: 'macOS app — needs setup-hooks step' },
  { id: 'cowork',  label: 'Cowork (web)',      subtitle: 'Browser — needs setup-hooks step' },
];

const PLUGIN_INSTALL_CMD = `/plugin marketplace add https://github.com/Implexa-Inc/implexa-claude-plugin.git
/plugin install implexa@implexa`;

const SETUP_HOOKS_CMD = `curl -sL https://raw.githubusercontent.com/Implexa-Inc/implexa-claude-plugin/main/scripts/install-user-hooks.sh | bash`;

export default function InstallFlow({ hasKey, keyPrefix }: { hasKey: boolean; keyPrefix: string | null }) {
  const [surface, setSurface] = useState<Surface>('cli');

  // Step 3 (setup-hooks) is REQUIRED for Claude Desktop and Cowork because their
  // sandbox silently drops plugin-packaged hooks (`--setting-sources user`).
  // For Claude Code CLI it's optional — plugin hooks fire natively there.
  const step3Required = surface !== 'cli';

  return (
    <>
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
          {SURFACES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSurface(s.id)}
              className={`px-3 py-2 rounded-md text-sm transition-colors text-left ${
                surface === s.id
                  ? 'bg-brand-500 text-ink-950 font-medium shadow-glow'
                  : 'bg-ink-800 text-ink-200 hover:bg-ink-700 border border-ink-700'
              }`}
            >
              <div className="font-medium">{s.label}</div>
              <div className={`text-[10px] mt-0.5 ${surface === s.id ? 'text-ink-950/70' : 'text-ink-400'}`}>{s.subtitle}</div>
            </button>
          ))}
        </div>

        {/* Surface-specific content */}
        <SurfaceContent surface={surface} hasKey={hasKey} />
      </Section>

      {/* ── Step 3: Setup hooks ──────────────────────────────────────── */}
      <Section
        number={3}
        title="Configure capture hooks"
        required={step3Required}
        subtitle={surface === 'cli'
          ? 'Optional for CLI users (plugin hooks fire natively here), but recommended for consistency across surfaces.'
          : 'Required — Claude Desktop / Cowork sandbox plugin hooks. Run this in your terminal once.'}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-300 leading-relaxed">
            Copy the command below, then open <strong>Terminal</strong> and paste (<kbd className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1 py-0.5 font-mono">⌘V</kbd> then <kbd className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1 py-0.5 font-mono">↵</kbd>).
            <span className="block text-ink-400 mt-1">
              Don&apos;t have Terminal open? Press <kbd className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1 py-0.5 font-mono">⌘Space</kbd>, type <em>terminal</em>, press <kbd className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1 py-0.5 font-mono">↵</kbd>.
            </span>
          </p>
          <CodeBlock code={SETUP_HOOKS_CMD} oneLine />
          <details className="text-xs text-ink-300">
            <summary className="cursor-pointer hover:text-ink-100 select-none">What does this script do?</summary>
            <div className="mt-2 pl-4 space-y-1 leading-relaxed">
              <p>• Installs <code className="text-[11px] bg-ink-800 px-1 rounded">jq</code> if missing (one-time, via Homebrew)</p>
              <p>• <strong>Prompts you to paste your API key</strong>, then stores it in <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/implexa.env</code> (chmod 600). Have your key ready.</p>
              <p>• Writes a launcher at <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/implexa-hook.sh</code></p>
              <p>• Patches <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/settings.json</code> to register hooks (backs up the original)</p>
              <p>• Runs a smoke test to verify the chain works</p>
              <p>• Idempotent — safe to re-run anytime</p>
            </div>
          </details>
        </div>
      </Section>

      {/* ── Step 4: Restart + test ───────────────────────────────────── */}
      <Section number={4} title="Restart Claude + record your first skill">
        <div className="space-y-3">
          <p className="text-sm text-ink-200 leading-relaxed">
            {surface === 'cli'
              ? <>Type <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/exit</code> to leave Claude Code, then run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">claude</code> in your terminal.</>
              : <>Fully quit Claude with <strong>Cmd+Q</strong> (not just close the window — settings.json hooks need a fresh session), then relaunch.</>}
          </p>
          <p className="text-sm text-ink-200 leading-relaxed">
            Then run <code className="bg-ink-800 px-1.5 py-0.5 rounded text-xs">/implexa:record-skill</code> to capture your first workflow. Implexa will record every prompt + response + tool call, then walk you through an interview to extract decision points + output contract + outcome signal.
          </p>
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
          <strong>Plugin hooks fire natively in Claude Code CLI.</strong> Step 3 (setup-hooks) is technically optional here — but recommended for parity if you also use Desktop/Cowork.
        </p>
      </>
    );
  }

  if (surface === 'desktop') {
    return (
      <>
        <p className="text-sm text-ink-200 mb-3 leading-relaxed">
          Launch Claude Desktop, then in the menu bar click <strong>Customize</strong>:
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
          You do <strong>not</strong> need your API key for this step — it&apos;s only used in Step 3.
        </p>
        <p className="text-xs mt-3 leading-relaxed text-red-600 dark:text-red-400">
          <strong>⚠ Step 3 is required.</strong> Claude Desktop sandboxes plugin-packaged hooks, so the user-level hooks installer is needed for the killer feature (prompt + response capture). Without it you&apos;ll still get tool-call capture but `conversationTurns: 0`.
        </p>
        <details className="text-xs text-ink-300 mt-3">
          <summary className="cursor-pointer hover:text-ink-100 select-none">Can&apos;t find &ldquo;Customize&rdquo;?</summary>
          <div className="mt-2 pl-4 leading-relaxed space-y-1">
            <p>In Claude Desktop, look in the left sidebar (the one with Skills, Connectors, etc.). If hidden, toggle the sidebar from the View menu.</p>
          </div>
        </details>
        <details className="text-xs text-ink-300 mt-2">
          <summary className="cursor-pointer hover:text-ink-100 select-none">What about API key setup?</summary>
          <div className="mt-2 pl-4 leading-relaxed">
            <p>Claude Desktop is a GUI app and doesn&apos;t inherit your shell&apos;s <code className="text-[11px] bg-ink-800 px-1 rounded">IMPLEXA_API_KEY</code>. {apiKeyHint} The setup script (Step 3) will prompt you to paste your key, then stores it in a config file the launcher loads.</p>
          </div>
        </details>
      </>
    );
  }

  // cowork
  return (
    <>
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
        <li>The <code className="text-xs bg-ink-800 px-1 rounded">implexa</code> plugin should appear — click <strong>Install</strong> on its row</li>
      </ol>
      <p className="text-xs text-ink-400 mt-3 leading-relaxed">
        You do <strong>not</strong> need your API key for this step — it&apos;s only used in Step 3.
      </p>
      <p className="text-xs mt-3 leading-relaxed text-red-600 dark:text-red-400">
        <strong>⚠ Step 3 is required for capture.</strong> Cowork&apos;s sandbox runs Claude with <code className="bg-ink-800 px-1 rounded">--setting-sources user</code>, which silently ignores plugin-packaged hooks. You&apos;ll get tool-call capture but no prompt/response capture without user-level hooks.
      </p>
      <details className="text-xs text-ink-300 mt-3">
        <summary className="cursor-pointer hover:text-ink-100 select-none">Wait — do I run the setup script in Cowork?</summary>
        <div className="mt-2 pl-4 leading-relaxed">
          <p>No. Run it on your <strong>local Mac</strong> (Terminal.app), even if you primarily use Cowork. The hooks need to be installed at the <code className="text-[11px] bg-ink-800 px-1 rounded">~/.claude/settings.json</code> level on your machine — Cowork reads from your local config.</p>
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
