import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import generated from '../../../test-fixtures/generated/agent-marketplace-slice1.json' with { type: 'json' };

test('admitted discovery card names the exact version and opens the marketplace resume', async () => {
  const agent = {
    ...generated.available,
    audition: {
      allowance: 2,
      remaining: 2,
      providerCostMode: 'buyer_owned',
      disclosure: 'Buyer-owned usage.',
      eligible: false,
    },
  };
  const rendered = await render('agent-discovery-catalog.tsx', { agents: [agent] });
  try {
    assert.match(rendered.text(), /Only reviewed, exact-version agents appear here/);
    assert.match(rendered.text(), new RegExp(`exact version ${agent.version.number.replaceAll('.', '\\.')}`));
    assert.match(rendered.text(), /Free audition offered · buyer-owned provider usage/);
    const link = rendered.getByText('View & use this agent') as HTMLAnchorElement;
    assert.equal(link.getAttribute('href'), `/workflows/${agent.slug}`);
  } finally { rendered.cleanup(); }
});

test('unavailable discovery fails closed without rendering stale hire actions', async () => {
  const rendered = await render('agent-discovery-catalog.tsx', { agents: [], unavailable: 'Discovery read failed.' });
  try {
    assert.match(rendered.text(), /No agent can be hired until its exact version and readiness are verified/);
    assert.equal(rendered.queryByText('View & use this agent'), null);
  } finally { rendered.cleanup(); }
});

test('search filters the authoritative discovery packet', async () => {
  const second = { ...generated.available, id: '99999999-9999-4999-8999-999999999999', slug: 'proof-reader', name: 'Proof Reader', job: 'Review a final draft.' };
  const rendered = await render('agent-discovery-catalog.tsx', { agents: [generated.available, second] });
  try {
    const search = rendered.document.querySelector('[aria-label="Search admitted agents"]') as HTMLInputElement;
    await rendered.act(() => {
      const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'Proof Reader');
      search.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
    });
    assert.ok(rendered.queryByText('Proof Reader'));
    assert.equal(rendered.queryByText(generated.available.name), null);
  } finally { rendered.cleanup(); }
});
