export const TEACHING_MODEL = 'claude-haiku-4-5';
export const MAX_TEACHING_FRAME_BYTES = 2 * 1024 * 1024;
export const TEACHING_FIELDS = ['chosen', 'why', 'process', 'desiredBehavior'] as const;
export type TeachingFields = Record<typeof TEACHING_FIELDS[number], string>;
export type SuggestionBinding = { sourceId: string; sourceSha256: string; timeMs: number; frameSha256: string;
  questionReceiptId: string; questionReceiptDigest: string; expectedActiveVersionId: string; feedbackSha256: string };
export type TeachingSuggestion = { ok: true; contractVersion: 'training-teaching-suggestion.v1'; model: string;
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
  if (!exact(v, ['ok', 'contractVersion', 'model', 'binding', 'status', 'fields', 'reason', 'sources']) || v.ok !== true
    || v.contractVersion !== 'training-teaching-suggestion.v1' || typeof v.model !== 'string' || !v.model.startsWith(TEACHING_MODEL)
    || !exact(v.binding, Object.keys(expected)) || Object.entries(expected).some(([k, value]) => v.binding[k] !== value)
    || typeof v.reason !== 'string' || v.reason.length > 300 || !exact(v.sources, [...TEACHING_FIELDS])
    || v.sources.chosen !== 'observed_frame' || v.sources.why !== 'trainer_preference'
    || v.sources.process !== 'transferable_guidance' || v.sources.desiredBehavior !== 'transferable_guidance') return false;
  return v.status === 'insufficient' ? v.fields === null && Boolean(v.reason.trim())
    : v.status === 'suggested' && v.reason === '' && exact(v.fields, [...TEACHING_FIELDS])
      && TEACHING_FIELDS.every(k => typeof v.fields[k] === 'string' && v.fields[k].trim() && v.fields[k].length <= 400);
}
