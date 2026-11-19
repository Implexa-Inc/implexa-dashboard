import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const firstArtifact = '11111111-1111-4111-8111-111111111111';
const secondArtifact = '22222222-2222-4222-8222-222222222222';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function update(directorySnapshot = true) {
  return {
    workflow_version_id: '33333333-3333-4333-8333-333333333333',
    version: 4,
    state: 'compatible',
    input_contract_digest: 'c'.repeat(64),
    input_contract: {
      version: 'workflow-input-contract.v1',
      fields: [{
        key: 'project_bundle', label: 'Project bundle', description: 'Editable project files',
        kind: 'file', cardinality: 'one', required: true, order: 1,
        accept: { extensions: ['.zip'], mediaTypes: ['application/zip'], ...(directorySnapshot ? { directorySnapshot: true } : {}) },
      }],
    },
  };
}

// Folder selection lives in the RUN experience now. Activation stopped rendering
// any picker at all (spec §3.3), so the capability is exercised where a user can
// actually reach it — see agent-update-gate.test.ts for the assertion that
// activation offers none.
function runProps(directorySnapshot = true) {
  return {
    slug: 'folder-agent', name: 'Folder agent', isActive: true,
    workflowVersionId: '33333333-3333-4333-8333-333333333333',
    inputContractDigest: 'c'.repeat(64), inputContract: update(directorySnapshot).input_contract,
  };
}

function backend(setup: Record<string, unknown> = { schema: [], answers: {}, note: '', runInputDefaults: {} }) {
  return (path: string) => path.startsWith('/api/v2/agent-training/agents/') ? { ok: true, home: {
    agent: { currentVersionId: '33333333-3333-4333-8333-333333333333' },
    successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: '33333333-3333-4333-8333-333333333333', eligiblePredecessor: null },
    managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references', workflowVersionId: '33333333-3333-4333-8333-333333333333', classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [], readiness: 'not_applicable', reason: null },
  } } : setup;
}

test('B-roll-heavy recommends a duration-based cap and lets the user change it', async () => {
  const props = runProps();
  const fields = [
    { key: 'presenter_video', label: 'Presenter video', kind: 'file', cardinality: 'one',
      description: 'Choose a video.', required: true, order: 1, accept: { extensions: ['.mp4'], mediaTypes: ['video/mp4'] } },
    { key: 'creative_direction', label: 'Creative direction', kind: 'choice', cardinality: 'one',
      description: 'Choose a direction.', required: false, order: 1, options: ['Balanced', 'Cinematic B-roll-heavy'] },
    { key: 'higgsfield_credit_limit', label: 'Higgsfield budget (credits)', kind: 'choice', cardinality: 'one',
      description: 'Optional allowance.', required: false, order: 2, options: ['0', '25', '50', '100'] },
  ];
  let picks = 0;
  const r = await render('agent-actions.tsx', { ...props, inputContract: { ...props.inputContract, fields } }, {
    backend: backend(), bridge: {
      pickRunInput: async () => ({ ok: false, canceled: true }),
      pickDeferredRunInput: async (options: Record<string, unknown>) => {
        assert.equal(options.includeDurationHint, true);
        const pick = picks++;
        return { ok: true, ...options, selectionId: pick < 2 ? firstArtifact : secondArtifact,
          displayName: 'presenter.mp4', sizeBytes: 1024, mediaType: 'video/mp4', fileExtension: '.mp4',
          requiredMachineId: 'fixture-machine', durationHintMs: [42_733, 600_000][pick] };
      },
    },
  });
  try {
    await r.click(r.getByText('▶ Run now'));
    const direction = r.document.querySelector<HTMLSelectElement>('select[aria-label="Creative direction"]')!;
    const budget = r.document.querySelector<HTMLSelectElement>('select[aria-label="Higgsfield budget (credits)"]')!;
    const change = (field: HTMLSelectElement, value: string) => r.act(() => {
      field.value = value;
      field.dispatchEvent(new r.window.Event('change', { bubbles: true }));
    });
    assert.equal(budget.selectedOptions[0].text, 'Select…');
    await change(direction, 'Cinematic B-roll-heavy');
    assert.equal(budget.value, '');
    assert.equal(budget.selectedOptions[0].text, 'Choose a credit limit');
    await r.click(r.getByText('Choose file'));
    assert.match(r.text(), /Aim for 1–2 B-roll clips/);
    await r.click(r.getByText('Use 25 credits · suggested cap'));
    assert.equal(budget.value, '25');
    await r.click(r.getByText('Replace file'));
    assert.match(r.text(), /Aim for 20–30 B-roll clips/);
    assert.ok(r.getByText('Use 100 credits · agent maximum'));
    assert.equal(budget.value, '25', 'replacing the source updates guidance without increasing the selected cap');
    await change(budget, '50');
    assert.equal(budget.selectedOptions[0].text, 'Optimize for B-roll within 50 credits');
    await change(direction, 'Balanced');
    assert.equal(budget.value, '50', 'changing direction keeps an explicitly chosen cap');
    assert.equal(budget.selectedOptions[0].text, '50');
    await change(direction, 'Cinematic B-roll-heavy');
    await change(budget, '0');
    assert.equal(budget.selectedOptions[0].text, '0 credits · Use available footage');
    await r.click(r.getByText('Replace file'));
    assert.ok(r.document.querySelector('input[type="number"]'), 'older Desktop can estimate from a manually entered length');
  } finally { r.cleanup(); }
});

test('Run now renders folder selection only for a declared directory snapshot capability', async () => {
  const rendered = await render('agent-actions.tsx', runProps(true), {
    backend: backend(),
    bridge: { pickRunInput: async () => ({ ok: false, canceled: true }) },
  });
  try {
    await rendered.click(rendered.getByText('▶ Run now'));
    assert.ok(rendered.queryByText('Choose file'));
    assert.ok(rendered.queryByText('Choose folder'));
  } finally { rendered.cleanup(); }

  const zipOnly = await render('agent-actions.tsx', runProps(false), {
    backend: backend(),
    bridge: { pickRunInput: async () => ({ ok: false, canceled: true }) },
  });
  try {
    await zipOnly.click(zipOnly.getByText('▶ Run now'));
    assert.ok(zipOnly.queryByText('Choose file'));
    assert.equal(zipOnly.queryByText('Choose folder'), null,
      'accepting ZIP files does not imply permission to snapshot a directory');
  } finally { zipOnly.cleanup(); }
});

test('a directory response that is not a frozen directory snapshot refuses visibly', async () => {
  const rendered = await render('agent-actions.tsx', runProps(true), {
    backend: backend(),
    bridge: {
      pickRunInput: async (options: Record<string, unknown>) => ({
        ok: true, artifactId: firstArtifact, sha256: digestA, displayName: 'Project.zip',
        origin: 'file', inputSessionId: options.inputSessionId,
      }),
    },
  });
  try {
    await rendered.click(rendered.getByText('▶ Run now'));
    await rendered.click(rendered.getByText('Choose folder'));
    assert.match(rendered.text(), /cannot attach a folder/i);
    assert.equal(rendered.queryByText('Replace with folder'), null);
  } finally { rendered.cleanup(); }
});

test('Run Now uses the same declared folder capability and replacement identity', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const rendered = await render('agent-actions.tsx', {
    slug: 'folder-agent', name: 'Folder agent', isActive: true,
    workflowVersionId: '33333333-3333-4333-8333-333333333333',
    inputContractDigest: 'c'.repeat(64), inputContract: update(true).input_contract,
  }, {
    backend: backend(),
    bridge: {
      pickRunInput: async (options: Record<string, unknown>) => {
        calls.push(options);
        const replacement = calls.length > 1;
        return {
          ok: true,
          artifactId: replacement ? secondArtifact : firstArtifact,
          sha256: replacement ? digestB : digestA,
          displayName: replacement ? 'Project-v2.zip' : 'Project.zip',
          origin: 'directory-snapshot', inputSessionId: options.inputSessionId,
        };
      },
    },
  });
  try {
    await rendered.click(rendered.getByText('▶ Run now'));
    await rendered.click(rendered.getByText('Choose folder'));
    assert.equal(calls[0].selection, 'directory');
    assert.match(rendered.text(), /Project\.zip/);
    await rendered.click(rendered.getByText('Replace with folder'));
    assert.equal(calls[1].replacesArtifactId, firstArtifact);
    assert.match(rendered.text(), /Project-v2\.zip/);
    assert.doesNotMatch(rendered.text(), /Project\.zip —/);
  } finally { rendered.cleanup(); }
});

test('Run Now shows folder preparation, blocks duplicate picks and ignores an older saved-source refusal', async () => {
  let finishFolder!: (value: Record<string, unknown>) => void;
  let finishSaved!: (value: Record<string, unknown>) => void;
  const folderResult = new Promise<Record<string, unknown>>((resolve) => { finishFolder = resolve; });
  const savedResult = new Promise<Record<string, unknown>>((resolve) => { finishSaved = resolve; });
  let picks = 0;
  let pickedSession = '';
  const rendered = await render('agent-actions.tsx', {
    slug: 'folder-agent', name: 'Folder agent', isActive: true,
    workflowVersionId: '33333333-3333-4333-8333-333333333333',
    inputContractDigest: 'c'.repeat(64), inputContract: update(true).input_contract,
  }, {
    backend: backend({
      schema: [], answers: {}, note: '',
      runInputDefaults: { project_bundle: '/saved/project-bundle.zip' },
    }),
    bridge: {
      bindSavedRunInput: async () => savedResult,
      pickRunInput: async (options: Record<string, unknown>) => {
        picks += 1;
        pickedSession = String(options.inputSessionId || '');
        return folderResult;
      },
    },
  });
  try {
    await rendered.click(rendered.getByText('▶ Run now'));
    await rendered.click(rendered.getByText('Choose folder'));

    assert.match(rendered.text(), /Preparing and verifying a ZIP from this folder/);
    assert.ok((rendered.getByText('Preparing ZIP…') as HTMLButtonElement).disabled);
    assert.ok((rendered.getByText('Choose file') as HTMLButtonElement).disabled);
    assert.ok((rendered.getByText('▶ Run now') as HTMLButtonElement).disabled,
      'Run cannot serialize the prior binding while its replacement is still being created');

    await rendered.click(rendered.getByText('Preparing ZIP…'));
    assert.equal(picks, 1, 'a second click cannot start another snapshot for the same field');

    await rendered.act(() => finishSaved({ ok: false, error: 'registration_rejected' }));
    assert.doesNotMatch(rendered.text(), /rejected this file/,
      'the saved-input refusal belongs to the value superseded when folder preparation began');

    await rendered.act(() => finishFolder({
      ok: true, artifactId: firstArtifact, sha256: digestA, displayName: 'Project.zip',
      origin: 'directory-snapshot', inputSessionId: pickedSession,
    }));
    assert.equal(rendered.queryByText('Preparing ZIP…'), null);
    assert.match(rendered.text(), /Project\.zip — frozen from a folder, verified, bound to project_bundle/);
    assert.doesNotMatch(rendered.text(), /rejected this file/);
  } finally { rendered.cleanup(); }
});
