// node --test "app/(dashboard)/_components/outcome-work-item.render.test.ts"
//
// The one Work item. What must hold:
//   1. The outcome is TYPED and rendered as the backend stated it — a partial
//      is "Partially delivered", never dressed up as success.
//   2. Artifacts carry their digests; provenance names the exact agent
//      versions and the versioned scorer; the plan receipt shows the
//      backend's settled figures verbatim.
//   3. Verification/judge states render as their own words — "not verified"
//      stays visible, never converted to a claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import fixture from '../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };

test('a delivered Work item shows artifacts with digests, provenance, and the plan receipt', async () => {
  const rendered = await render('outcome-work-item.tsx', { receipt: fixture.receipts.success });
  try {
    assert.ok(rendered.queryByText('Delivered'));
    assert.ok(rendered.document.querySelector('[aria-label="Work item"]'));

    // Artifacts, each with its digest prefix.
    assert.ok(rendered.queryByText('final-master.mp4'));
    assert.ok(rendered.queryByText('shot.mp4'));
    for (const artifact of fixture.receipts.success.artifacts) {
      assert.match(rendered.text(), new RegExp(artifact.digest.slice(0, 16)));
    }

    // Provenance: the exact selected path and the versioned scorer.
    assert.ok(rendered.queryByText(/1\. Cinematic Shot Generator/));
    assert.ok(rendered.queryByText(/2\. Visual Evidence & Remotion Compositor/));
    assert.match(rendered.text(), /outcome-scorer\.v1/);
    assert.match(rendered.text(), new RegExp(fixture.receipts.success.planDigest.slice(0, 12)));

    // The receipt's settled credit figures, verbatim.
    assert.match(rendered.text(), /35 credits/);
    assert.match(rendered.text(), /100 credits/);
    assert.ok(rendered.queryByText(/verification: verified complete/));
    assert.ok(rendered.queryByText(/Review:/));
  } finally { rendered.cleanup(); }
});

test('a partial outcome stays partial, with the typed reason and honest child states', async () => {
  const rendered = await render('outcome-work-item.tsx', { receipt: fixture.receipts.partial });
  try {
    assert.ok(rendered.queryByText('Partially delivered'));
    assert.equal(rendered.queryByText('Delivered'), null, 'a partial never renders the success badge');
    assert.match(rendered.text(), /One child did not complete/);
    assert.ok(rendered.queryByText(/verification: failed/), 'failure stays visible');
    assert.ok(rendered.queryByText(/judge: fail/));
    assert.equal(rendered.queryByText('final-master.mp4'), null, 'an unproduced artifact never renders');
  } finally { rendered.cleanup(); }
});
