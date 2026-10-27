import { TRAINING_PROPERTY_CODES, TRAINING_STAGE_OPTIONS, type TrainingPropertyCode, type TrainingStage } from './training-local-ingress.ts';

export type QuestionTeaching = { sessionId: string; recordId: string; recordDigest: string; state: 'prepared' | 'taught' | 'not_eligible'; reason: string | null; targetVersionId: string | null };
export type TrainerQuestion = {
  id: string; receiptDigest: string; createdAt: string; questionId: string; question: string; sceneElement: string;
  property: TrainingPropertyCode; stage: TrainingStage; questionVersionId: string; runId: string;
  runState: string | null; runStatus: string | null; outcome: 'matched' | 'no_match'; returnedReferenceIds: string[];
  recordedEvidence: false; fallback: null; recurrenceCount: number; teachings: QuestionTeaching[];
};
export type QuestionsPage = { ok: true; contractVersion: 'trainer-questions.v1'; agentFamilyId: string; activeVersionId: string | null; items: TrainerQuestion[]; nextCursor: { createdAt: string; id: string } | null };
export type QuestionAnswer = { questions: TrainerQuestion[]; rawAnswer: string; expectedActiveVersionId: string };
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const id = (v: unknown) => typeof v === 'string' && UUID.test(v);
const sha = (v: unknown) => typeof v === 'string' && SHA.test(v);
const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const reason = (v: unknown) => v === null || text(v, 160);
function teaching(v: any): v is QuestionTeaching {
  return exact(v, ['sessionId', 'recordId', 'recordDigest', 'state', 'reason', 'targetVersionId'])
    && id(v.sessionId) && id(v.recordId) && sha(v.recordDigest)
    && ['prepared', 'taught', 'not_eligible'].includes(v.state) && reason(v.reason)
    && (v.targetVersionId === null || id(v.targetVersionId));
}
export function questionsPage(v: any): v is QuestionsPage {
  return exact(v, ['ok', 'contractVersion', 'agentFamilyId', 'activeVersionId', 'items', 'nextCursor'])
    && v.ok === true && v.contractVersion === 'trainer-questions.v1' && id(v.agentFamilyId)
    && (v.activeVersionId === null || id(v.activeVersionId)) && Array.isArray(v.items) && v.items.length <= 20
    && new Set(v.items.map((q: any) => q?.id)).size === v.items.length
    && v.items.every((q: any) => exact(q, ['id', 'receiptDigest', 'createdAt', 'questionId', 'question', 'sceneElement', 'property', 'stage', 'questionVersionId', 'runId', 'runState', 'runStatus', 'outcome', 'returnedReferenceIds', 'recordedEvidence', 'fallback', 'recurrenceCount', 'teachings'])
      && id(q.id) && sha(q.receiptDigest) && time(q.createdAt) && text(q.questionId, 64)
      && text(q.question, 600) && text(q.sceneElement, 160) && TRAINING_PROPERTY_CODES.includes(q.property)
      && TRAINING_STAGE_OPTIONS.some(s => s.value === q.stage) && id(q.questionVersionId) && id(q.runId)
      && (q.runState === null || text(q.runState, 80)) && (q.runStatus === null || text(q.runStatus, 80))
      && ['matched', 'no_match'].includes(q.outcome) && Array.isArray(q.returnedReferenceIds)
      && q.returnedReferenceIds.length <= 3 && q.returnedReferenceIds.every((id: unknown) => typeof id === 'string' && UUID.test(id))
      && new Set(q.returnedReferenceIds).size === q.returnedReferenceIds.length
      && q.recordedEvidence === false && q.fallback === null && Number.isSafeInteger(q.recurrenceCount) && q.recurrenceCount >= 1
      && Array.isArray(q.teachings) && q.teachings.every((t: unknown) => teaching(t) && t.targetVersionId === v.activeVersionId))
    && (v.nextCursor === null || exact(v.nextCursor, ['createdAt', 'id']) && time(v.nextCursor.createdAt) && id(v.nextCursor.id));
}
export function validAnswerBody(v: any): boolean {
  return exact(v, ['questionReceiptId', 'questionReceiptDigest', 'recordId', 'expectedRecordDigest', 'rawAnswer', 'expectedActiveVersionId'])
    && id(v.questionReceiptId) && sha(v.questionReceiptDigest) && id(v.recordId)
    && sha(v.expectedRecordDigest) && id(v.expectedActiveVersionId) && text(v.rawAnswer, 2000)
    && new TextEncoder().encode(v.rawAnswer).length <= 8000;
}
export function answerReceipt(v: any, body: any): boolean {
  return exact(v, ['ok', 'contractVersion', 'questionReceiptId', 'recordId', 'recordDigest', 'targetVersionId', 'teachingState', 'reason', 'linkReceiptId', 'idempotent'])
    && v.ok === true && v.contractVersion === 'trainer-question-answer.v1' && v.questionReceiptId === body.questionReceiptId
    && v.recordId === body.recordId && v.recordDigest === body.expectedRecordDigest && v.targetVersionId === body.expectedActiveVersionId
    && ['prepared', 'taught', 'not_eligible'].includes(v.teachingState) && reason(v.reason)
    && id(v.linkReceiptId) && typeof v.idempotent === 'boolean';
}
export function questionGroups(items: TrainerQuestion[]) {
  const groups = new Map<string, TrainerQuestion[]>();
  for (const q of items) { const key = `${q.questionVersionId}:${q.stage}:${q.property}`; groups.set(key, [...(groups.get(key) || []), q]); }
  return [...groups.values()];
}
