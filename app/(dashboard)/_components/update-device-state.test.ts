import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const banner = fs.readFileSync(new URL('./update-banner.tsx', import.meta.url), 'utf8');
const engines = fs.readFileSync(new URL('../settings/engines/engines-client.tsx', import.meta.url), 'utf8');
const updatesPage = fs.readFileSync(new URL('../settings/updates/page.tsx', import.meta.url), 'utf8');
const updateStatus = fs.readFileSync(new URL('../settings/updates/plugin-update-status.tsx', import.meta.url), 'utf8');
const layout = fs.readFileSync(new URL('../layout.tsx', import.meta.url), 'utf8');

test('the Desktop update banner waits for this machine and never paints account-wide versions', () => {
  assert.match(banner, /pluginVersions\?: \(\) => Promise/);
  assert.match(banner, /useState<BehindSurface\[]>\(\[\]\)/);
  assert.match(banner, /if \(!inDesktop \|\| !machineChecked\) return null/);
  assert.match(banner, /native\.pluginVersions\(\)/);
  assert.doesNotMatch(banner, /deriveBehind\(installed,/);
  assert.doesNotMatch(layout, /plugin_versions|computeBehind|getLatestVersions/);
});

test('engine settings replaces account-wide rows with the Desktop machine report', () => {
  assert.match(engines, /engineStatus\?: \(\) => Promise/);
  assert.match(engines, /native\.engineStatus\(\)/);
  assert.match(engines, /const effectiveReports = localReports \|\| reports/);
});

test('Claude permissions has instructions, not the removed deep link', () => {
  assert.doesNotMatch(engines, /claude:\/\/settings\/permissions/);
  assert.match(engines, /Open Claude Settings, then Permissions or Capabilities/);
});

test('the Updates page also uses this Mac and never the account-wide users row', () => {
  assert.doesNotMatch(updatesPage, /plugin_version|plugin_versions/);
  assert.match(updateStatus, /native\.pluginVersions\(\)/);
  assert.match(updateStatus, /Installed separately for Claude and Codex on each Mac/);
});
