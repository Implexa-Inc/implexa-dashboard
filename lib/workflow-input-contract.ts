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
