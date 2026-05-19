'use client';

/**
 * Reusable social-share row for skill pages.
 *
 * Drops onto /skills/[slug] (owner view) and /s/[token] (public share preview).
 * Compact icon-buttons; each opens the target platform's share intent URL with
 * pre-filled title + URL where the platform supports it. Discord has no
 * share-intent endpoint, so we fall back to "copy a Discord-friendly message"
 * the user pastes into whichever server/channel they want.
 *
 * Pre-filled copy is intentionally bare — name + 1-line description + URL.
 * The user adds their own framing when posting (canned founder voice is worse
 * than no founder voice).
 */

import { useState } from 'react';

type Props = {
  /** The canonical URL to share. */
  url: string;
  /** Skill name. Used as the title in HN/Reddit submissions and in pre-filled tweet text. */
  title: string;
  /** Short 1-line description. Used as body text on Twitter/LinkedIn previews; truncated if needed. */
  description: string;
  /** Visual scale. 'compact' = icon + 1-word label; 'full' = with "Share:" prefix. */
  variant?: 'compact' | 'full';
};

// ─── Intent URL builders ────────────────────────────────────────────────
// All URLs use encodeURIComponent on each parameter to handle emoji,
// quotation marks, ampersands etc. in skill names/descriptions.

const twitterIntent = (text: string, url: string) =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

const linkedinIntent = (url: string) =>
  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

const hnIntent = (url: string, title: string) =>
  `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(title)}`;

const redditIntent = (url: string, title: string) =>
  `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;

// ─── Pre-filled text per platform ───────────────────────────────────────
// Kept neutral. Add hashtags / framing on the consuming side if needed
// (Twitter has 280-char limit; URL is shortened by t.co so we have ~250 chars
// of real text to play with, but we keep it short — users edit before posting).

function buildTweetText(title: string, description: string): string {
  const desc = description.length > 140 ? description.slice(0, 137).trimEnd() + '…' : description;
  return `🎯 ${title}\n\n${desc}\n\nBuilt with Implexa — agentskills.io compatible.`;
}

function buildHnTitle(title: string): string {
  // HN is strict about title format — avoid emoji, keep under 80 chars.
  const clean = title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const suffix = ' — built with Implexa';
  const maxNameLen = 80 - suffix.length;
  return (clean.length > maxNameLen ? clean.slice(0, maxNameLen - 1) + '…' : clean) + suffix;
}

function buildRedditTitle(title: string, description: string): string {
  // Reddit titles max ~300 chars but shorter is better; use name + first clause of description.
  const firstClause = description.split(/[.—•]/)[0]?.trim() || description.slice(0, 100);
  return `${title} — ${firstClause}`;
}

function buildDiscordMessage(title: string, description: string, url: string): string {
  return `🎯 **${title}**\n${description}\n${url}\n\n_Built with Implexa — agentskills.io compatible. Runs in Claude Code, Cursor, Hermes, and 30+ more._`;
}

// ─── Component ──────────────────────────────────────────────────────────

export function ShareButtons({ url, title, description, variant = 'compact' }: Props) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedDiscord, setCopiedDiscord] = useState(false);

  const tweetText      = buildTweetText(title, description);
  const hnTitle        = buildHnTitle(title);
  const redditTitle    = buildRedditTitle(title, description);
  const discordMessage = buildDiscordMessage(title, description, url);

  async function copyToClipboard(text: string, setter: (b: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 1500);
    } catch (_) {
      // Browsers without clipboard access — silently no-op rather than alert spam
    }
  }

  const btnBase =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-ink-200 hover:text-ink-50 hover:bg-ink-800 border border-ink-700 hover:border-ink-500 transition-colors whitespace-nowrap';

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Share this skill">
      {variant === 'full' && <span className="text-xs text-ink-400 mr-1 self-center">Share:</span>}

      {/* X (formerly Twitter) */}
      <a
        href={twitterIntent(tweetText, url)}
        target="_blank"
        rel="noopener noreferrer"
        className={btnBase}
        aria-label="Share on X"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span>X</span>
      </a>

      {/* LinkedIn */}
      <a
        href={linkedinIntent(url)}
        target="_blank"
        rel="noopener noreferrer"
        className={btnBase}
        aria-label="Share on LinkedIn"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
        <span>LinkedIn</span>
      </a>

      {/* Hacker News */}
      <a
        href={hnIntent(url, hnTitle)}
        target="_blank"
        rel="noopener noreferrer"
        className={btnBase}
        aria-label="Submit to Hacker News"
      >
        <span className="font-bold text-[10px] leading-none bg-brand-500/15 text-brand-500 px-1 rounded">Y</span>
        <span>HN</span>
      </a>

      {/* Reddit */}
      <a
        href={redditIntent(url, redditTitle)}
        target="_blank"
        rel="noopener noreferrer"
        className={btnBase}
        aria-label="Submit to Reddit"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12c-.688 0-1.249.561-1.249 1.25 0 .688.561 1.249 1.249 1.249a1.25 1.25 0 100-2.499zm5.5 0a1.25 1.25 0 100 2.498 1.25 1.25 0 000-2.498zm-5.466 3.99a.328.328 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.094z" />
        </svg>
        <span>Reddit</span>
      </a>

      {/* Discord — no share intent; copy a formatted message */}
      <button
        type="button"
        onClick={() => copyToClipboard(discordMessage, setCopiedDiscord)}
        className={btnBase}
        aria-label="Copy a Discord-friendly message to share"
        title="Copy a pre-formatted message you can paste into any Discord channel"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
        <span>{copiedDiscord ? '✓ Copied' : 'Discord'}</span>
      </button>

      {/* Copy raw link */}
      <button
        type="button"
        onClick={() => copyToClipboard(url, setCopiedLink)}
        className={btnBase}
        aria-label="Copy link"
      >
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
        </svg>
        <span>{copiedLink ? '✓ Copied' : 'Copy link'}</span>
      </button>
    </div>
  );
}
