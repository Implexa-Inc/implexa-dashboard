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

test('activation renders folder selection only for a declared directory snapshot capability', async () => {
  const rendered = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update(true) }, {
    bridge: { pickRunInput: async () => ({ ok: false, canceled: true }) },
  });
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    assert.ok(rendered.queryByText('Choose file'));
    assert.ok(rendered.queryByText('Choose folder'));
  } finally { rendered.cleanup(); }

  const zipOnly = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update(false) }, {
    bridge: { pickRunInput: async () => ({ ok: false, canceled: true }) },
  });
  try {
    await zipOnly.click(zipOnly.getByText('Review & activate update'));
    assert.ok(zipOnly.queryByText('Choose file'));
    assert.equal(zipOnly.queryByText('Choose folder'), null,
      'accepting ZIP files does not imply permission to snapshot a directory');
  } finally { zipOnly.cleanup(); }
});

test('activation freezes a folder and releases only its explicit predecessor on replacement', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const replies = [
    { ok: true, artifactId: firstArtifact, sha256: digestA, displayName: 'Project.zip', origin: 'directory-snapshot' },
    { ok: true, artifactId: secondArtifact, sha256: digestB, displayName: 'Project-v2.zip', origin: 'directory-snapshot' },
  ];
  const rendered = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update(true) }, {
    bridge: {
      pickRunInput: async (options: Record<string, unknown>) => {
        calls.push(options);
        return { ...replies[calls.length - 1], inputSessionId: options.inputSessionId };
      },
    },
  });
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    await rendered.click(rendered.getByText('Choose folder'));
    assert.match(rendered.text(), /Project\.zip — frozen from a folder, verified, bound to project_bundle/);
    assert.deepEqual(calls[0].selection, 'directory');
    assert.deepEqual(calls[0].accept, { extensions: ['.zip'], mediaTypes: ['application/zip'], directorySnapshot: true });
    assert.equal('replacesArtifactId' in calls[0], false);

    await rendered.click(rendered.getByText('Replace with folder'));
    assert.match(rendered.text(), /Project-v2\.zip — frozen from a folder, verified, bound to project_bundle/);
    assert.doesNotMatch(rendered.text(), /Project\.zip —/);
    assert.equal(calls[1].inputSessionId, calls[0].inputSessionId, 'replacement stays in the same frozen session');
    assert.equal(calls[1].replacesArtifactId, firstArtifact,
      'only the binding this control replaces is eligible for store cleanup');
  } finally { rendered.cleanup(); }
});

test('a directory response that is not a frozen directory snapshot refuses visibly', async () => {
  const rendered = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update(true) }, {
    bridge: {
      pickRunInput: async (options: Record<string, unknown>) => ({
        ok: true, artifactId: firstArtifact, sha256: digestA, displayName: 'Project.zip',
        origin: 'file', inputSessionId: options.inputSessionId,
      }),
    },
  });
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
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
    backend: () => ({ schema: [], answers: {}, note: '', runInputDefaults: {} }),
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
    backend: () => ({
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
