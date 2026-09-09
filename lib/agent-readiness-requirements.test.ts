// node --test lib/agent-readiness-requirements.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredApiKeys } from './agent-readiness-requirements.ts';

const service = (overrides: Record<string, unknown>) => ({
  key: 'higgsfield', name: 'Higgsfield', cost: 'usage-based', url: 'https://example.test',
  alt: null, provider: 'higgsfield', keyOnMachine: false, ...overrides,
});

test('only a positively required absent API key blocks readiness', () => {
  assert.deepEqual(missingRequiredApiKeys([
    service({ name: 'Planning reference', apiKeyRequired: false }),
    service({ name: 'Browser provider', apiKeyRequired: false, accessMode: 'browser' }),
    service({ name: 'Unknown legacy detection', apiKeyRequired: null, accessMode: 'unknown' }),
    service({ name: 'Available required key', apiKeyRequired: true, keyOnMachine: true }),
    service({ name: 'Missing required key', apiKeyRequired: true }),
  ]), ['Missing required key']);
});

