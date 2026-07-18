// node --test lib/requirements-provider-parity.test.ts
// (Node 22.6+ strips the types natively)
//
// GUARD — every non-null `provider` in lib/requirements.ts's SERVICES list must
// be a real LOCAL_KEY_VAULT provider slug, or <InlineAddKeyButton> opens the
// local key-entry window for a provider the vault (implexa-backend's
// API_KEY_PROVIDERS in workflow-capabilities.js) has never heard of — a typo'd
// or invented slug would fail silently client-side (openKeySetup would just
// error, or worse, no-op) rather than at build time.
//
// This file's own top comment already promises "kept in sync … if the backend
// tables grow, mirror the additions" — this test is what makes that promise
// checkable instead of just prose. implexa-backend is a SIBLING repo (not this
// one's CI checkout), so this can't grep it directly in CI; instead it pins the
// known-good provider slug set as of 2026-07-18 (backend workflow-capabilities.js
// API_KEY_PROVIDERS: runway, heygen, elevenlabs, resend, firecrawl, serpapi).
// If the backend registry changes, update both this list AND requirements.ts's
// SERVICES entries in the same change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRequirements } from './requirements.ts';

// Snapshot of implexa-backend's API_KEY_PROVIDERS slugs (workflow-capabilities.js).
const KNOWN_VAULT_PROVIDERS = new Set(['runway', 'heygen', 'elevenlabs', 'resend', 'firecrawl', 'serpapi']);

// Every regex in SERVICES, exercised via one synthetic step per entry so
// detectRequirements actually returns each service (rather than reaching into
// the module-private SERVICES array).
const TRIGGER_TEXT: Record<string, string> = {
  'Runway ML': 'Generate a clip in Runway ML',
  HeyGen: 'Render the avatar with HeyGen',
  Seedance: 'Generate via Seedance',
  ElevenLabs: 'Narrate with ElevenLabs',
  OpenAI: 'Generate an image via the OpenAI API',
};

test('every service with a non-null provider uses a real vault provider slug', () => {
  for (const [name, text] of Object.entries(TRIGGER_TEXT)) {
    const { services } = detectRequirements([{ label: text }]);
    const svc = services.find((s) => s.name === name);
    assert.ok(svc, `detectRequirements should have matched a service for "${text}"`);
    if (svc!.provider !== null) {
      assert.ok(
        KNOWN_VAULT_PROVIDERS.has(svc!.provider),
        `"${name}"'s provider "${svc!.provider}" is not a known vault provider slug — either it's a typo, or the backend's API_KEY_PROVIDERS registry gained a new entry that this test's snapshot needs to include`,
      );
    }
  }
});

test('Seedance shares HeyGen\'s provider (no separate vault entry — it rides HeyGen credits)', () => {
  const { services } = detectRequirements([{ label: 'Generate via Seedance' }]);
  const svc = services.find((s) => s.name === 'Seedance');
  assert.equal(svc?.provider, 'heygen');
});

test('a service the vault does not support yet (OpenAI) has provider: null, not a guessed slug', () => {
  const { services } = detectRequirements([{ label: 'Generate an image via the OpenAI API' }]);
  const svc = services.find((s) => s.name === 'OpenAI');
  assert.equal(svc?.provider, null);
});
