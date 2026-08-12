import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dashboard = join(import.meta.dirname, '..');

for (const route of ['create/page.tsx', 'browse/page.tsx']) {
  test(`${route} uses admitted discovery rather than the legacy workflow catalog`, () => {
    const source = readFileSync(join(dashboard, route), 'utf8');
    assert.match(source, /listAgentDiscovery\(session\.access_token\)/);
    assert.match(source, /<AgentDiscoveryCatalog/);
    assert.doesNotMatch(source, /listWorkflows\(/);
    assert.doesNotMatch(source, /<CommunityAgents/);
  });
}
