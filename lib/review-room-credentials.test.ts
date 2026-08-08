// node --test lib/review-room-credentials.test.ts
//
// The Review write path must never put a credential in the browser.
//
// Same boundary, and the same idiom, as professional-v2-ui.test.ts: the client
// component posts an ACTION to a same-origin route; the route resolves that action
// through an allowlist and attaches the signed-in user's Supabase JWT server-side.
// The browser never sees the token, never learns the backend origin, and no
// service-role key exists anywhere on this path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const component = read('../app/(dashboard)/_components/review-room.tsx');
const actions = read('./review-actions.ts');
const flow = read('./review-submission-flow.ts');
const proxy = read('../app/api/review/route.ts');

/**
 * Comments explain the boundary and are expected to NAME it; code must not touch it.
 * Scanning the raw file would flag the sentence "the session token stays server-side".
 */
const codeOnly = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('no Review client module handles a token, a key, or the backend origin', () => {
  for (const [name, source] of [
    ['review-room.tsx', component],
    ['review-actions.ts', actions],
    ['review-submission-flow.ts', flow],
  ] as const) {
    const code = codeOnly(source);
    for (const forbidden of [
      /authorization:/i, /Bearer/, /access_token/, /SERVICE_ROLE/i,
      /NEXT_PUBLIC_IMPLEXA_API_URL/, /core\.implexa\.ai/, /supabase/i,
    ]) {
      assert.doesNotMatch(code, forbidden, `${name} must not reference ${forbidden}`);
    }
  }
});

test('the browser posts to the same-origin proxy, never to the backend', () => {
  assert.match(component, /fetch\('\/api\/review'/, 'the client no longer goes through the proxy');
  assert.doesNotMatch(codeOnly(component), /https?:\/\//,
    'the client component names an absolute origin');
});

test('the proxy attaches the signed-in user’s JWT and never a service role', () => {
  assert.match(proxy, /supabase\.auth\.getSession\(\)/);
  assert.match(proxy, /session\?\.access_token/);
  assert.match(proxy, /authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(proxy, /status: 401/, 'an unauthenticated caller is not refused');
  assert.doesNotMatch(proxy, /SERVICE_ROLE/i);
});

test('the proxy is an allowlist, not a passthrough', () => {
  assert.match(proxy, /resolveReviewAction/);
  // A caller-supplied path or headers would let any client bug reach an arbitrary
  // backend endpoint as the signed-in user.
  assert.doesNotMatch(proxy, /body\.path|body\.url|target\.headers/);
});

test('the submit action forwards ONLY the session id and the note', () => {
  const submit = actions.slice(actions.indexOf("case 'submit'"), actions.indexOf("case 'accept'"));
  const forwarded = /body: \{([^}]*)\}/.exec(submit);
  assert.ok(forwarded, 'the submit body could not be located');
  // Nothing but the note rides along: no issue ids, no digests, no identity the
  // server did not ask for and would not verify.
  assert.match(forwarded![1], /revisionNote/);
  assert.doesNotMatch(forwarded![1], /issue|digest|token|user/i);
});

test('the revision note never reaches the browser console or a URL', () => {
  const code = codeOnly(component);
  assert.doesNotMatch(code, /console\.(log|info|warn|error)\([^)]*revisionNote/,
    'the note is logged to the browser console');
  assert.doesNotMatch(code, /searchParams[^\n]*revisionNote|revisionNote[^\n]*searchParams/,
    'the note is placed in a URL');
});
