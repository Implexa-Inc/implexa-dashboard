import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dashboard = join(import.meta.dirname, '..');

for (const route of ['create/page.tsx']) {
  test(`${route} uses admitted discovery rather than the legacy workflow catalog`, () => {
    const source = readFileSync(join(dashboard, route), 'utf8');
    assert.match(source, /listAgentDiscovery\(session\.access_token\)/);
    assert.match(source, /<AgentDiscoveryCatalog/);
    assert.doesNotMatch(source, /listWorkflows\(/);
    assert.doesNotMatch(source, /<CommunityAgents/);
  });
}

test('old browse bookmarks redirect to the single trained-agent catalog',()=>{
 const source=readFileSync(join(dashboard,'browse/page.tsx'),'utf8');
 assert.match(source,/redirect\('\/workflows\?tab=rent'\)/);
 assert.doesNotMatch(source,/listWorkflows|AgentDiscoveryCatalog/);
});
