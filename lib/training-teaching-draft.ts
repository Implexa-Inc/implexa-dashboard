export const TEACHING_MODEL = 'claude-haiku-5-5';
export const MAX_TEACHING_FRAME_BYTES = 2 * 1024 * 1024;
export const TEACHING_FIELDS = ['chosen', 'why', 'process', 'desiredBehavior'] as const;
export type TeachingFields = Record<typeof TEACHING_FIELDS[number], string>;
type FrameBinding = { sourceId: string; sourceSha256: string; timeMs: number; frameSha256: string;
  expectedActiveVersionId: string; feedbackSha256: string };
export type SuggestionBinding = FrameBinding & ({ questionReceiptId: string; questionReceiptDigest: string }
  | { annotationId: string; annotationDigest: string });
export type DemoAnnotation = { annotationId: string; annotationDigest: string; rawAnnotation: string;
  sourceId: string; sourceSha256: string; timeMs: number; frameSha256: string; expectedActiveVersionId: string };
export type TeachingSuggestion = { ok: true; contractVersion: 'training-teaching-suggestion.v2' | 'training-teaching-suggestion.v3'; model: string;
  requestId: string;
  binding: SuggestionBinding; status: 'suggested' | 'insufficient'; fields: TeachingFields | null; reason: string;
  sources: { chosen: 'observed_frame'; why: 'trainer_preference'; process: 'transferable_guidance'; desiredBehavior: 'transferable_guidance' } };
const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export async function teachingDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function teachingFrame(image: string): Uint8Array {
  if (!image.startsWith('data:image/png;base64,') || image.length > 2800000) throw Error('This frame is too large for suggestions. Keep drafting manually; no frame was sent.');
  const bytes = Uint8Array.from(atob(image.slice(22)), c => c.charCodeAt(0));
  if (bytes.length > MAX_TEACHING_FRAME_BYTES || bytes.length < 33) throw Error('This frame cannot be used for suggestions. Keep drafting manually; no frame was sent.');
  return bytes;
}
export function teachingSuggestion(v: any, expected: SuggestionBinding): v is TeachingSuggestion {
  if (!exact(v, ['ok', 'contractVersion', 'model', 'requestId', 'binding', 'status', 'fields', 'reason', 'sources']) || v.ok !== true
    || typeof v.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.requestId)
    || v.contractVersion !== ('annotationId' in expected ? 'training-teaching-suggestion.v3' : 'training-teaching-suggestion.v2') || typeof v.model !== 'string' || v.model !== TEACHING_MODEL
    || !exact(v.binding, Object.keys(expected)) || Object.entries(expected).some(([k, value]) => v.binding[k] !== value)
    || typeof v.reason !== 'string' || v.reason.length > 300 || !exact(v.sources, [...TEACHING_FIELDS])
    || v.sources.chosen !== 'observed_frame' || v.sources.why !== 'trainer_preference'
    || v.sources.process !== 'transferable_guidance' || v.sources.desiredBehavior !== 'transferable_guidance') return false;
  return v.status === 'insufficient' ? v.fields === null && Boolean(v.reason.trim())
    : v.status === 'suggested' && v.reason === '' && exact(v.fields, [...TEACHING_FIELDS])
      && TEACHING_FIELDS.every(k => typeof v.fields[k] === 'string' && v.fields[k].trim() && v.fields[k].length <= 400);
}
export function demoAnnotationReceipt(v: any, expected: Omit<DemoAnnotation, 'annotationId' | 'annotationDigest'>): v is { ok: true; annotationId: string; annotationDigest: string; annotation: Record<string, unknown> } {
  return v?.ok === true && v.contractVersion === 'training-demo-annotation.v1'
    && typeof v.annotationId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.annotationId)
    && typeof v.annotationDigest === 'string' && /^[a-f0-9]{64}$/.test(v.annotationDigest)
    && v.annotation?.contractVersion === 'training-demo-annotation.v1'
    && Object.entries(expected).every(([key,value]) => v.annotation[key === 'expectedActiveVersionId' ? 'targetVersionId' : key] === value);
}
export function teachingFailure(value: unknown, status: number): string {
  const messages: Record<string, string> = {
    scope_session: 'The training session could not be verified.', scope_version: 'The active agent version could not be verified.',
    scope_source: 'The selected source could not be verified.', scope_question: 'The recorded question could not be read through its authorized scope.',
    scope_annotation: 'The saved demonstration annotation could not be verified.',
    provider_not_configured: 'The drafting provider is not configured.', provider_auth: 'The drafting provider rejected its credentials.',
    provider_refused: 'The drafting provider declined this request.',
    provider_model_unavailable: 'The configured drafting model is unavailable.', provider_rejected: 'The drafting provider rejected the request.',
    provider_rate_limited: 'The drafting provider is rate-limited.', provider_unavailable: 'The drafting provider is unavailable.',
    provider_timeout: 'The drafting request timed out.', cancelled: 'The drafting request was cancelled.',
    response_format_invalid: 'The drafting reply was not valid JSON.', response_schema_invalid: 'The drafting reply did not fit the teaching fields.',
    proxy_response_invalid: 'The Training backend returned an unreadable reply.', proxy_timeout: 'The Training proxy timed out.', backend_unreachable: 'The Training backend could not be reached.',
    rate_limited: 'Too many drafting requests were made recently.', invalid: 'The selected frame or drafting request is invalid.',
  };
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const suffix = typeof v.reason === 'string' ? v.reason.replace(/^teaching_suggestion_/, '') : '';
  const aliases: Record<string, string> = { session_not_found: 'scope_session', agent_active_version_changed: 'scope_version', source_not_found: 'scope_source', question_not_found: 'scope_question', demo_annotation_not_found: 'scope_annotation', demo_annotation_scope_invalid: 'scope_annotation' };
  const code = Object.hasOwn(messages, suffix) ? suffix : Object.hasOwn(aliases, suffix) ? aliases[suffix] : undefined;
  const reference = typeof v.requestId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v.requestId) ? ` · reference ${v.requestId}` : '';
  return `${code ? messages[code] : 'Suggestions are unavailable or did not match this frame.'} Your answer and manual draft are preserved. (HTTP ${status}${code ? ` · ${code}` : ''}${reference})`;
}
