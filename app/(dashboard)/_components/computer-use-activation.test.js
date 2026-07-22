'use strict';

// Guard the activation seam: a declared provider browser route must produce a
// visible, local-macOS setup path and must gate the dashboard's Activate CTA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CARD = fs.readFileSync(path.join(__dirname, 'activation-card.tsx'), 'utf8');

test('Computer Use is an activation prerequisite with honest Implexa/macOS copy', () => {
  assert.match(CARD, /function ComputerUseSetup/);
  assert.match(CARD, /Screen Recording/);
  assert.match(CARD, /Accessibility/);
  assert.match(CARD, /macOS may say “Implexa wants to record this computer’s screen”/);
  assert.match(CARD, /computerUseSatisfied/);
  assert.match(CARD, /Set up required Computer Use/);
});

test('Computer Use readiness is local-desktop evidence, not a remote dashboard claim', () => {
  assert.match(CARD, /bridge\?\.computerUsePermissionsStatus/);
  assert.match(CARD, /onReady\(!!next\?\.ready\)/);
  assert.match(CARD, /openComputerUsePermissions\(pane\)/);
  assert.doesNotMatch(CARD, /grantComputerUse/);
});

test('a stale server runtime report never unlocks the current macOS preflight', () => {
  assert.match(CARD, /const \[computerUseReady, setComputerUseReady\] = useState\(\(\) => !serverComputerUseCheck\)/);
  assert.match(CARD, /status\(\)\s*\.then\(\(next\) => \{ if \(!cancelled\) setComputerUseReady\(!!next\?\.ready\); \}\)/);
  assert.match(CARD, /step\.id === 'computer-use'\s*\? \(computerUseLocallyComplete \? 'done' : 'todo'\)/);
  assert.doesNotMatch(CARD, /useState\(\(\) => serverComputerUseCheck\?\.status === 'ok'\)/);
});
