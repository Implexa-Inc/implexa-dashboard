export type WorkflowInputField = {
  key: string;
  label: string;
  description: string;
  kind: 'text' | 'choice' | 'file';
  required: boolean;
  accept?: { mediaTypes: string[]; extensions: string[] };
  options?: string[];
  cardinality: 'one' | 'many';
  order: number;
  /**
   * Setup questions this run input supersedes, by key.
   *
   * The declared, versioned answer to "is the saved `source_video` question the
   * same thing as the fresh `target_video_source` input?" — which the two
   * vocabularies otherwise have no way to express, so the Run-now form asked for
   * the raw video twice and let a months-old saved path compete with the fresh
   * one. Identity only; nothing here or on the server infers it from labels.
   */
  replaces?: string[];
};

export type WorkflowInputContract = { version: 1; fields: WorkflowInputField[] };
export type ArtifactBinding = {
  artifactId: string;
  sha256: string;
  displayName: string;
  mediaType?: string;
};
export type RunInputValue = ArtifactBinding | string | ArtifactBinding[] | string[];
export type RunInputBindings = Record<string, RunInputValue>;

export function orderedInputFields(contract: WorkflowInputContract | null): WorkflowInputField[] {
  return contract ? [...contract.fields].sort((a, b) => a.order - b.order) : [];
}

/** A folder can satisfy a typed file field only by becoming an immutable ZIP
 * artifact. The declared .zip extension is the authority; prose is not. */
export function acceptsDirectorySnapshot(field: WorkflowInputField): boolean {
  return field.kind === 'file'
    && (field.accept?.extensions ?? []).some((extension) => extension.toLowerCase() === '.zip');
}

/**
 * Which setup questions this contract has taken ownership of.
 *
 * A field's own key counts: a run input and a setup question sharing a key are
 * the same identity by definition, and rendering both is the same defect wearing
 * a simpler disguise.
 */
export function supersededSetupKeys(contract: WorkflowInputContract | null): Set<string> {
  const keys = new Set<string>();
  for (const field of orderedInputFields(contract)) {
    keys.add(field.key);
    for (const replaced of field.replaces ?? []) keys.add(replaced);
  }
  return keys;
}

/**
 * The setup questions that are still genuinely the user's to answer once.
 *
 * These are PREFERENCES — b-roll density, aspect ratio, preferred engine, a
 * standing style note — reused on every run. What is left after this filter is
 * exactly what belongs in the saved-preferences section, and nothing in it can
 * be a second way to answer a question the Run Inputs section already asks.
 *
 * The server resolves the same thing against the version each user is pinned to
 * and no longer serves a superseded question at all. This runs anyway: a client
 * deployed ahead of that backend must not spend that window rendering the
 * duplicate, and a filter that depends on deploy order is not a contract.
 */
export function reusablePreferences<T extends { key: string }>(
  fields: T[],
  contract: WorkflowInputContract | null,
): T[] {
  const superseded = supersededSetupKeys(contract);
  return fields.filter((field) => !superseded.has(field.key));
}

export function missingRequiredInputs(
  contract: WorkflowInputContract | null,
  bindings: RunInputBindings,
): WorkflowInputField[] {
  return orderedInputFields(contract).filter((field) => {
    if (!field.required) return false;
    const value = bindings[field.key];
    return value === undefined || value === null || (typeof value === 'string' && !value.trim())
      || (Array.isArray(value) && value.length === 0);
  });
}

/**
 * Name what a file field will actually take.
 *
 * An accept block is an INTERSECTION — a field declaring both extensions and
 * media types requires both. Naming only the extension would tell a user whose
 * correctly-suffixed file was refused to go and pick the same thing again.
 */
function describeAcceptedTypes(field: WorkflowInputField): string {
  const extensions = field.accept?.extensions ?? [];
  const mediaTypes = field.accept?.mediaTypes ?? [];
  if (extensions.length && mediaTypes.length) {
    return ` It needs a ${extensions.join(' or ')} file that is also ${mediaTypes.join(' or ')} — this one matched only one of the two.`;
  }
  if (extensions.length) return ` Choose a ${extensions.join(' or ')} file.`;
  if (mediaTypes.length) return ` It accepts ${mediaTypes.join(' or ')}.`;
  return '';
}

/**
 * Turn a Desktop `pickRunInput` failure code into something the user can act on.
 *
 * Every one of these used to be swallowed: the picker closed, no filename
 * appeared, Run stayed disabled, and nothing said why. An unexplained dead
 * button is indistinguishable from a broken product, so an unrecognised code
 * still produces a message — it names the code rather than saying nothing.
 */
export function describeInputPickerError(code: string | undefined, field: WorkflowInputField): string {
  switch (code) {
    case 'incompatible_file_type':
      return `That file isn't an accepted type for “${field.label}”.${describeAcceptedTypes(field)}`;
    case 'not_linked':
      return 'Implexa Desktop is not linked to your account yet. Sign in from the desktop app, then choose the file again.';
    case 'forbidden':
      return 'Implexa Desktop would not accept this page. Open the agent from the Implexa desktop app window and try again.';
    case 'registration_unavailable':
      return 'Could not reach Implexa to verify this file. Check your connection, then choose it again.';
    case 'registration_rejected':
      return 'Implexa rejected this file when verifying it. Choose it again, or pick a different file.';
    case 'registration_identity_mismatch':
      return 'This file’s verified identity did not match what Implexa recorded. Choose it again.';
    case 'source_changed_while_hashing':
      return 'The file changed while it was being verified. Make sure nothing is still writing to it, then choose it again.';
    case 'not_a_regular_file':
      return 'That is not a regular file. Choose a file rather than a folder, alias, or symlink.';
    case 'directory_not_accepted':
      return `“${field.label}” does not accept a folder snapshot. Choose one of its accepted files instead.`;
    case 'not_a_directory':
    case 'invalid_directory_selection':
      return 'That is not a selectable folder. Choose a real folder rather than an alias or symlink.';
    case 'directory_contains_symlink':
    case 'directory_contains_special_file':
      return 'That folder contains a symlink or unsupported special file. Remove it or create a ZIP yourself, then try again.';
    case 'directory_too_many_entries':
    case 'directory_too_large':
      return 'That folder is too large to attach safely. Create a smaller project folder or ZIP, then try again.';
    case 'directory_changed_while_snapshotting':
      return 'That folder changed while Implexa was packaging it. Stop any writes to it, then choose it again.';
    case 'directory_unreadable':
    case 'directory_unavailable':
      return 'Implexa could not read that folder. Check its permissions and choose it again.';
    case 'directory_snapshot_failed':
    case 'directory_source_read_short':
    case 'directory_snapshot_write_stalled':
      return 'Implexa could not create a verified ZIP snapshot of that folder. Check free disk space, then try again.';
    case 'invalid_input_registration':
      return `Implexa Desktop could not register a file for “${field.label}”. Update the desktop app, then try again.`;
    default:
      return code
        ? `Could not attach this file (${code}). Choose it again, or pick a different file.`
        : 'Could not attach this file. Choose it again, or pick a different file.';
  }
}

/** Exactly what Desktop's `files:pickRunInput` resolves to. */
export type PickRunInputResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  inputSessionId?: string;
  artifactId?: string;
  sha256?: string;
  displayName?: string;
  mediaType?: string;
};

export type PickerOutcome =
  | { kind: 'canceled' }
  | { kind: 'failed'; message: string }
  | { kind: 'bound'; binding: ArtifactBinding; inputSessionId: string };

/**
 * Decide what a Desktop picker result means for one contract field.
 *
 * Three outcomes, and the difference between them is the whole bug:
 *  - `canceled` — the user dismissed the dialog. Change nothing, say nothing.
 *  - `failed`   — Desktop refused. Say why, and leave the field unbound.
 *  - `bound`    — a verified artifact, to be stored under `field.key`.
 *
 * Every failure used to collapse into "return", so a refused file and a cancel
 * looked identical: the picker closed and Run stayed disabled with no reason
 * given. An older Desktop reports a cancel as a bare `{ ok:false }` with no
 * code, so "no code" is read as a cancel and never as a silent failure.
 */
export function resolvePickerResult(
  result: PickRunInputResult | null | undefined,
  field: WorkflowInputField,
): PickerOutcome {
  if (!result?.ok) {
    if (result?.canceled === true || !result?.error) return { kind: 'canceled' };
    return { kind: 'failed', message: describeInputPickerError(result.error, field) };
  }
  // A success we cannot bind is a failure. Treating it as one is what stops
  // "the picker closed and nothing happened" from ever being the outcome again.
  if (!result.artifactId || !result.sha256 || !result.displayName || !result.inputSessionId) {
    return { kind: 'failed', message: describeInputPickerError('incomplete_registration', field) };
  }
  return {
    kind: 'bound',
    inputSessionId: result.inputSessionId,
    binding: {
      artifactId: result.artifactId,
      sha256: result.sha256,
      displayName: result.displayName,
      ...(result.mediaType ? { mediaType: result.mediaType } : {}),
    },
  };
}

/** Store a freshly bound artifact under its own contract key — never by order. */
export function bindInputValue(
  previous: RunInputBindings,
  field: WorkflowInputField,
  binding: ArtifactBinding,
): RunInputBindings {
  if (field.cardinality !== 'many') return { ...previous, [field.key]: binding };
  const current = previous[field.key];
  const list = Array.isArray(current)
    ? current.filter((value): value is ArtifactBinding => typeof value === 'object')
    : [];
  return { ...previous, [field.key]: [...list, binding] };
}

export function serializeArtifactBindings(bindings: RunInputBindings): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === 'string') result[key] = value;
    else if (Array.isArray(value)) result[key] = value.map((entry) => typeof entry === 'string'
      ? entry
      : { artifactId: entry.artifactId, sha256: entry.sha256 });
    else result[key] = { artifactId: value.artifactId, sha256: value.sha256 };
  }
  return result;
}
