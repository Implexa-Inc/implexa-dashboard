// Tests for lib/web-analytics.ts: no secret in an app URL reaches Vercel Web Analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scrubAnalyticsUrl } from './web-analytics.ts';

test('auth codes, reset tokens and fragment tokens are removed', () => {
  assert.equal(
    scrubAnalyticsUrl('https://app.implexa.ai/auth/callback?code=abc123&next=%2Fcoach'),
    'https://app.implexa.ai/auth/callback',
  );
  assert.equal(
    scrubAnalyticsUrl('https://app.implexa.ai/reset-password?token_hash=xyz&type=recovery'),
    'https://app.implexa.ai/reset-password',
  );
  assert.equal(
    scrubAnalyticsUrl('https://app.implexa.ai/login#access_token=secret&refresh_token=secret2'),
    'https://app.implexa.ai/login',
  );
});

test('marketing source parameters are kept', () => {
  assert.equal(
    scrubAnalyticsUrl('https://app.implexa.ai/signup?next=%2Fcoach&cta=tukido_experts&lp=%2F&utm_source=tukido.ai&utm_medium=site&utm_campaign=experts&email=a%40b.c'),
    'https://app.implexa.ai/signup?utm_source=tukido.ai&utm_medium=site&utm_campaign=experts&cta=tukido_experts&lp=%2F',
  );
});

test('share-link tokens are masked', () => {
  assert.equal(scrubAnalyticsUrl('https://app.implexa.ai/s/tok_123'), 'https://app.implexa.ai/s/[token]');
  assert.equal(scrubAnalyticsUrl('https://app.implexa.ai/s/tok_123/install?x=1'), 'https://app.implexa.ai/s/[token]/install');
  assert.equal(scrubAnalyticsUrl('https://app.implexa.ai/s/run/tok_456'), 'https://app.implexa.ai/s/run/[token]');
});

test('ordinary pages pass through and unparseable URLs are dropped', () => {
  assert.equal(scrubAnalyticsUrl('https://app.implexa.ai/coach'), 'https://app.implexa.ai/coach');
  assert.equal(scrubAnalyticsUrl('https://app.implexa.ai/session-review'), 'https://app.implexa.ai/session-review');
  assert.equal(scrubAnalyticsUrl('not a url'), null);
});
