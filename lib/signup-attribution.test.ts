// Tests for lib/signup-attribution.ts: what a new account records as its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attributionFromSignup,
  hasAttributionCookie,
  parseAttributionCookie,
  sanitizeAttribution,
  serializeAttributionCookie,
} from './signup-attribution.ts';

test('a website sign-up link keeps its source fields', () => {
  const a = attributionFromSignup(
    new URLSearchParams('intent=build%20x&cta=/workflows/x&lp=/blog/agents-md&ref=google.com&utm_source=hn'),
    'https://implexa.ai/workflows/x',
  );
  assert.deepEqual(a, {
    cta: '/workflows/x', lp: '/blog/agents-md', ref: 'google.com', intent: 'build x',
    utm_source: 'hn', entry: 'website',
  });
});

test('a direct visit uses an external referrer host and ignores our own hosts', () => {
  assert.deepEqual(
    attributionFromSignup(new URLSearchParams(''), 'https://www.github.com/Implexa-Inc/x?tab=1'),
    { entry: 'direct', ref: 'github.com' },
  );
  assert.deepEqual(
    attributionFromSignup(new URLSearchParams(''), 'https://app.implexa.ai/login'),
    { entry: 'direct' },
  );
});

test('the cookie round-trips and unknown or non-string fields are dropped', () => {
  const cookie = serializeAttributionCookie({ lp: '/blog/a b', entry: 'website' });
  const raw = cookie.split(';')[0].split('=').slice(1).join('=');
  assert.deepEqual(parseAttributionCookie(raw), { lp: '/blog/a b', entry: 'website' });
  assert.deepEqual(
    sanitizeAttribution({ lp: '/x', email: 'a@b.c', ref: 5, utm_source: 'x'.repeat(500) }),
    { lp: '/x', utm_source: 'x'.repeat(200) },
  );
  assert.equal(parseAttributionCookie('%E0%A4%A'), null);
  assert.equal(sanitizeAttribution([1]), null);
});

test('an existing cookie is detected so the first touch wins', () => {
  assert.equal(hasAttributionCookie('a=1; implexa_signup_src=%7B%7D'), true);
  assert.equal(hasAttributionCookie('a=1; implexa_signup_srcx=1'), false);
});
