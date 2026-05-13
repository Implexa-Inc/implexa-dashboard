'use client';

import { useState } from 'react';

type Props = {
  apiBase:   string;
  keyPrefix: string | null;
  hasKey:    boolean;
};

export default function InstallOptions({ apiBase, keyPrefix, hasKey }: Props) {
  const placeholder = hasKey ? `imp_live_${keyPrefix}…` : 'imp_live_...';

  const connectorUrl =
    `${apiBase}/api/v2/mcp?api_key=${placeholder}`;

  const claudeCodeCmd =
`# 1. install the plugin
claude plugin install implexa@github:Implexa-Inc/implexa-claude-plugin

# 2. set your key in your shell
export IMPLEXA_API_KEY="${placeholder}"
export IMPLEXA_API_URL="${apiBase}"

# 3. restart claude
claude`;

  const desktopConfig =
`{
  "mcpServers": {
    "implexa": {
      "command": "npx",
      "args": ["-y", "@implexa/mcp-server"],
      "env": {
        "IMPLEXA_API_KEY": "${placeholder}",
        "IMPLEXA_API_URL": "${apiBase}"
      }
    }
  }
}`;

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      {/* Option 1 — Custom Connector (easiest) */}
      <Card highlighted badge="⚡ 30-SECOND SETUP · EASIEST" optionNum="OPTION 1">
        <h3 className="text-xl font-semibold mb-2">Custom Connector — no install</h3>
        <p className="text-sm text-ink-200 mb-4">
          Works in <strong>Claude Desktop</strong> and <strong>Claude.ai web</strong>. Zero install. Just paste a URL.
        </p>

        <ol className="text-sm space-y-2 text-ink-200 list-decimal pl-4 mb-5">
          <li>In Claude: <strong>Settings → Connectors → Add custom connector</strong></li>
          <li>Name it <strong>Implexa</strong>, paste the URL below (replace the key placeholder with your real key)</li>
          <li>Leave OAuth Client ID / Secret empty. Save.</li>
          <li>28 tools appear in your tool picker.</li>
        </ol>

        <CopyBlock label="Connector URL" content={connectorUrl} />

        <p className="text-xs text-ink-500 mt-4">
          Don't have a key yet? <a href="/settings/api-keys" className="text-brand-600 hover:underline">Get one →</a>
        </p>
      </Card>

      {/* Option 2 — Claude Desktop / Cursor stdio */}
      <Card optionNum="OPTION 2">
        <h3 className="text-xl font-semibold mb-2">Claude Desktop / Cursor (stdio)</h3>
        <p className="text-sm text-ink-200 mb-4">
          Local stdio config with <code className="font-mono bg-ink-800 px-1 rounded text-xs">npx @implexa/mcp-server</code>. Key lives in your config.
        </p>

        <p className="text-xs text-ink-500 mb-2">Paste into your client's MCP config:</p>
        <CopyBlock content={desktopConfig} multiline />

        <p className="text-xs text-ink-500 mt-4">
          For <strong>Claude Desktop</strong>: <code className="font-mono text-xs">~/Library/Application Support/Claude/claude_desktop_config.json</code><br />
          For <strong>Cursor</strong>: Settings → MCP → Add Server
        </p>

        <a href="https://www.npmjs.com/package/@implexa/mcp-server" target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-3 inline-block">npm package →</a>
      </Card>

      {/* Option 3 — Claude Code plugin */}
      <Card optionNum="OPTION 3" badge="🛠 RECOMMENDED FOR CLAUDE CODE">
        <h3 className="text-xl font-semibold mb-2">Claude Code plugin</h3>
        <p className="text-sm text-ink-200 mb-4">
          Native install. Ships the 11 plugin skills + slash commands like <code className="font-mono bg-ink-800 px-1 rounded text-xs">/implexa:record-skill</code>.
        </p>

        <CopyBlock content={claudeCodeCmd} multiline />

        <a href="https://github.com/Implexa-Inc/implexa-claude-plugin" target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-3 inline-block">View on GitHub →</a>
      </Card>
    </div>
  );
}

function Card({ children, highlighted, badge, optionNum }: {
  children: React.ReactNode;
  highlighted?: boolean;
  badge?: string;
  optionNum: string;
}) {
  return (
    <div className={`card relative flex flex-col ${highlighted ? '!border-brand-500 !border-2' : ''}`}>
      {badge && (
        <div className={`absolute -top-3 left-4 text-xs font-medium px-2.5 py-1 rounded-full ${highlighted ? 'bg-brand-500 text-white' : 'bg-ink-800 text-ink-200'}`}>
          {badge}
        </div>
      )}
      <div className="text-xs uppercase tracking-wide text-ink-500 mb-3">{optionNum}</div>
      {children}
    </div>
  );
}

function CopyBlock({ label, content, multiline = false }: { label?: string; content: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      {label && <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">{label}</div>}
      <pre className={`text-xs bg-ink-950 text-ink-100 rounded p-3 code-dark overflow-x-auto pr-16 ${multiline ? 'whitespace-pre' : 'whitespace-pre-wrap break-all'}`}>{content}</pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-ink-700 text-ink-100 rounded hover:bg-ink-500 transition-colors"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}
