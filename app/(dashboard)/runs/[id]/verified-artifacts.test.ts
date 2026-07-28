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
  assert.match(page, /<VerifiedArtifacts artifacts=\{verifiedArtifacts\}/,
    'the trusted read must reach the rendered run page');
  assert.match(page, /<RunMarkdown markdown=\{r\.output_markdown\}/,
    'markdown remains a separate, untrusted presentation surface');
});

test('verified file actions use the validator-produced absolute path, while hiding it from the visible label', () => {
  assert.match(component, /openPath\?\.?:?/, 'component must support the desktop open bridge');
  assert.match(component, /artifact\.validatedPath/, 'Open/Finder must use the validated path, not worker prose');
  assert.match(component, /artifact\.relativePath\.split\('\/'\)\.at\(-1\)/,
    'the visible label should be a portable filename, not a home-directory path');
  assert.match(component, /Checked on this Mac by Implexa/, 'trust status must be explained to the user');
});
