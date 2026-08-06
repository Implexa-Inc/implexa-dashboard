/**
 * Two layers behind one form: what the user SAVED, and what they changed for
 * THIS run.
 *
 * The defect that put this file here: an agent whose per-run inputs were derived
 * from its own `freshEachRun` setup questions keeps its answers under the same
 * keys. The user answered all three in Setup, the card said "✓ all set", and
 * get_workflow_setup reported `complete: true` with every answer in `config` —
 * and then Run now opened with three empty controls and asked for all three
 * again, because the Run Inputs section was seeded from nothing but the file
 * picker. Saving worked; the form simply never read what saving produced.
 *
 * So the form is DEFAULTS plus OVERRIDES, and the difference is visible:
 *
 *   default   — the saved answer. Reused on every run until it is changed.
 *   override  — a change made in the pop-up. Applies to this run and no other,
 *               and is never written back to the saved answer.
 *   cleared   — an override that is blank. The user deliberately took the saved
 *               value out of THIS run; it stays saved for the next one.
 *
 * A blank is never sent. `validateInputBindings` refuses an empty string, so
 * submitting one would turn "left blank" into a run-create failure — and an
 * untouched optional field must never overwrite a saved preference with nothing,
 * which is the same rule seen from the other side.
 */

import {
  orderedInputFields,
  type ArtifactBinding, type RunInputBindings, type RunInputValue,
  type WorkflowInputContract, type WorkflowInputField,
} from './workflow-input-contract.ts';

/** Per-run changes, by contract key. A blank value means "cleared for this run". */
export type RunInputOverrides = Record<string, RunInputValue>;

/** Where the value in one control came from — the thing the form has to SAY. */
export type InputOrigin = 'saved' | 'override' | 'cleared' | 'empty';

export function isBlankInputValue(value: RunInputValue | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) {
    return value.filter((entry) => (typeof entry === 'string' ? entry.trim() !== '' : !!entry)).length === 0;
  }
  return false;
}

/**
 * The saved answers that belong to this contract, split by what the form can do
 * with them.
 *
 * A file field's saved value is a local PATH, and a path is a source, not a
 * binding: the run needs a verified artifact (digest, media type, a copy in the
 * workspace), which only the machine holding the file can produce. So it is
 * carried separately, shown as the saved source it is, and handed to Desktop to
 * verify — never quietly passed off as a binding it is not.
 */
export function readSavedRunInputs(
  contract: WorkflowInputContract | null,
  config: Record<string, unknown> | null | undefined,
): {
  /** Every saved value for a contract key, as the server holds it. */
  values: Record<string, string>;
  /** The ones that are already bindable as-is (text and choice). */
  bindable: RunInputBindings;
  /** File fields whose saved path still has to be verified on this machine. */
  filesToVerify: WorkflowInputField[];
} {
  const values: Record<string, string> = {};
  const bindable: RunInputBindings = {};
  const filesToVerify: WorkflowInputField[] = [];
  const saved = config && typeof config === 'object' ? config : {};
  for (const field of orderedInputFields(contract)) {
    const raw = (saved as Record<string, unknown>)[field.key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    values[field.key] = value;
    if (field.kind === 'file') { filesToVerify.push(field); continue; }
    // A choice whose saved answer is no longer one of its options is stale, not
    // an answer: offering it would fail `invalid_choice_binding` at run-create.
    if (field.kind === 'choice' && !(field.options || []).includes(value)) continue;
    bindable[field.key] = field.cardinality === 'many' ? [value] : value;
  }
  return { values, bindable, filesToVerify };
}

/** What one control shows: the override when the user made one, else the saved value. */
export function displayedInputValue(
  key: string,
  defaults: RunInputBindings,
  overrides: RunInputOverrides,
): RunInputValue | undefined {
  return key in overrides ? overrides[key] : defaults[key];
}

export function inputOrigin(
  key: string,
  defaults: RunInputBindings,
  overrides: RunInputOverrides,
): InputOrigin {
  if (key in overrides) return isBlankInputValue(overrides[key]) ? 'cleared' : 'override';
  return isBlankInputValue(defaults[key]) ? 'empty' : 'saved';
}

/**
 * The values this run actually gets: saved defaults with per-run overrides laid
 * over them, and every blank dropped.
 *
 * Dropping blanks is what makes "cleared" mean cleared and "untouched" mean
 * untouched — an override the user emptied removes the value from this run, and
 * a field nobody touched keeps its saved one. Neither ever writes back.
 */
export function resolveEffectiveInputs(
  contract: WorkflowInputContract | null,
  defaults: RunInputBindings,
  overrides: RunInputOverrides,
): RunInputBindings {
  const effective: RunInputBindings = {};
  for (const field of orderedInputFields(contract)) {
    const value = displayedInputValue(field.key, defaults, overrides);
    if (isBlankInputValue(value)) continue;
    effective[field.key] = value as RunInputValue;
  }
  return effective;
}

/** Store a verified artifact as the SAVED default for its field, not as an override. */
export function bindSavedArtifact(
  defaults: RunInputBindings,
  field: WorkflowInputField,
  binding: ArtifactBinding,
): RunInputBindings {
  return { ...defaults, [field.key]: field.cardinality === 'many' ? [binding] : binding };
}

/**
 * Name a saved value in one short phrase, so "use the saved one" can say WHICH.
 *
 * A file field's saved answer is a path and reads best as its filename; every
 * other field holds prose or a URL, where the leading text is what identifies it
 * and a filename split would show a query string.
 */
export function savedInputLabel(field: WorkflowInputField, value: string, max = 42): string {
  const text = field.kind === 'file' ? (value.split(/[\\/]/).pop() || value) : value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Exactly what Desktop's `files:bindSavedRunInput` resolves to. */
export type BindSavedInputResult = {
  ok: boolean;
  error?: string;
  inputSessionId?: string;
  artifactId?: string;
  sha256?: string;
  displayName?: string;
  mediaType?: string;
};

export type SavedBindOutcome =
  | { kind: 'bound'; binding: ArtifactBinding; inputSessionId: string }
  | { kind: 'failed'; message: string };

/**
 * Decide what Desktop made of the saved path for one field.
 *
 * No `canceled` case, and that is the point: the user never opened a dialog, so
 * every non-success here is something that has to be SAID. Silence would put us
 * back at an empty control with no reason for it — the defect this whole change
 * exists to remove, reappearing one layer down.
 */
export function resolveSavedBindResult(
  result: BindSavedInputResult | null | undefined,
  field: WorkflowInputField,
): SavedBindOutcome {
  if (!result?.ok) return { kind: 'failed', message: describeSavedInputError(result?.error, field) };
  if (!result.artifactId || !result.sha256 || !result.displayName || !result.inputSessionId) {
    return { kind: 'failed', message: describeSavedInputError('incomplete_registration', field) };
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

/**
 * Why a saved file could not be bound on this machine, in the user's terms.
 *
 * These are distinct from the picker's failures: nothing was picked, so "choose
 * it again" is not the instruction. Each one names what is actually wrong with
 * the SAVED answer, because the fix is to change that answer (or the file), not
 * to repeat an action the user never took.
 */
export function describeSavedInputError(code: string | undefined, field: WorkflowInputField): string {
  switch (code) {
    case 'saved_input_missing':
      return `The file saved for “${field.label}” isn’t there any more. Choose it again, or update it in Setup.`;
    case 'saved_input_not_a_local_path':
      return `What’s saved for “${field.label}” isn’t a file on this computer. Choose the file here, or save a local path in Setup.`;
    case 'incompatible_file_type':
      return `The file saved for “${field.label}” isn’t an accepted type for it. Choose a different one.`;
    case 'no_saved_input':
      return '';
    case 'saved_inputs_unsupported':
      return 'This copy of Implexa can’t reuse saved files yet. Choose the file for this run.';
    case 'saved_input_unavailable':
      return 'Could not reach Implexa to check your saved file. Choose it for this run, or try again.';
    case 'not_linked':
      return 'Implexa Desktop is not linked to your account yet. Sign in from the desktop app, then reopen this.';
    case 'source_changed_while_hashing':
      return `The file saved for “${field.label}” changed while it was being checked. Make sure nothing is still writing to it, then reopen this.`;
    default:
      return code
        ? `Could not use the file saved for “${field.label}” (${code}). Choose it for this run.`
        : `Could not use the file saved for “${field.label}”. Choose it for this run.`;
  }
}
