import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/(dashboard)/runs/[id]/page.tsx'), 'utf8');
const component = readFileSync(join(root, 'app/(dashboard)/_components/verified-artifacts.tsx'), 'utf8');

test('run detail surfaces only desktop-validated artifacts, separately from worker markdown', () => {
  assert.match(page, /from\('run_artifacts'\)/);
  assert.match(page, /\.eq\('status', 'validated'\)/,
    'declared/rejected worker claims must never become Open actions');
  assert.match(page, /<VerifiedArtifacts artifacts=\{verifiedArtifacts\} runId=\{r\.id\}/,
    'the trusted read must reach the rendered run page');
  assert.match(page, /<RunMarkdown markdown=\{r\.output_markdown\}/,
    'markdown remains a separate, untrusted presentation surface');
});

test('files are a first-class run section, not gated on a final markdown deliverable', () => {
  const files = page.indexOf('<VerifiedArtifacts artifacts={verifiedArtifacts} runId={r.id} />');
  const outputBranch = page.indexOf("{r.output_markdown ? (");
  assert.ok(files >= 0 && outputBranch >= 0 && files < outputBranch,
    'the files section must render before and independently of the output-markdown branch');
  assert.equal(page.match(/<VerifiedArtifacts artifacts=\{verifiedArtifacts\} runId=\{r\.id\} \/>/g)?.length, 1,
    'the run page should expose one stable artifacts surface, not a second buried copy');
});

test('a restarted Desktop exposes the explicit private-source reauthorization gate', () => {
  assert.match(component, /localInputReauthorizationState\?\:/,
    'the run page must ask Desktop whether its process-local source authority was lost');
  assert.match(component, /reauthorizeRunInputs\?\:/,
    'the recovery action must stay in the native bridge instead of accepting a browser path');
  assert.match(component, /Reconnect original source/);
  assert.match(component, /the file stays on this Mac/,
    'the user should understand that reconnecting does not upload their source');
  assert.match(component, /input_digest_mismatch/,
    'a wrong selection must be explained as an identity mismatch, not silently accepted');
});

test('verified file actions use the validator-produced absolute path, while hiding it from the visible label', () => {
  assert.match(component, /openPath\?\.?:?/, 'component must support the desktop open bridge');
  assert.match(component, /artifact\.validatedPath/, 'Open/Finder must use the validated path, not worker prose');
  assert.match(component, /artifact\.relativePath\.split\('\/'\)\.at\(-1\)/,
    'the visible label should be a portable filename, not a home-directory path');
  assert.match(component, /Checked on this Mac by Implexa/, 'trust status must be explained to the user');
});

test('every run exposes refresh and an expandable bounded artifact list', () => {
  assert.doesNotMatch(component, /if \(!artifacts\.length\) return null/,
    'a run opened before validation lands must not permanently lose its files surface');
  assert.match(component, /router\.refresh\(\)/, 'late Desktop validation must have an in-place refresh path');
  assert.match(component, /View files \(\$\{artifacts\.length\}\)/,
    'large artifact sets need a prominent count and explicit browse affordance');
  assert.match(component, /max-h-\[28rem\] overflow-y-auto/,
    'dozens of supporting artifacts must not make the entire run page unusable');
  assert.match(component, /artifact\.relativePath/, 'the expanded browser must retain the portable relative path');
});
