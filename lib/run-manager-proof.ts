export type ManagerProofStatus = 'ready' | 'none' | 'unavailable';
export type ManagerVerificationStatus = 'passed' | 'failed' | 'needs_you' | 'incomplete' | 'not_required' | 'unavailable';

export type ManagerStageProof = {
  stage: string;
  decisionCount: number;
  handlingStatus: 'reported' | 'not_recorded';
  appliedCount: number;
  exceptionCount: number;
  unavailableCount: number;
  refusedCount: number;
  causationClaim?: 'not_claimed';
  verificationStatus: 'passed' | 'failed' | 'needs_you' | 'not_recorded' | 'not_required' | 'unavailable';
  requiredCriterionCount: number;
  verifiedCriterionCount: number;
};

/**
 * Owner-safe Manager projection. It intentionally contains only aggregate stage
 * counts: no private decisions, criteria, traces, rationale, or Judge evidence.
 */
export type StageManagerProof = {
  status: ManagerProofStatus;
  unavailableReason?: string;
  stageCount: number;
  stages: ManagerStageProof[];
  handlingStatus?: 'ready' | 'incomplete';
  verificationStatus: ManagerVerificationStatus;
  disclosure?: 'aggregate_stage_proof_only';
};

export const MANAGER_PROOF_UNAVAILABLE: StageManagerProof = {
  status: 'unavailable',
  unavailableReason: 'manager_proof_read_failed',
  stageCount: 0,
  stages: [],
  verificationStatus: 'unavailable',
};

export function managerVerificationLabel(proof: StageManagerProof): string {
  switch (proof.verificationStatus) {
    case 'passed': return 'Manager proof passed';
    case 'failed': return 'Manager proof failed';
    case 'needs_you': return 'Manager needs your input';
    case 'incomplete': return 'Manager proof incomplete';
    case 'not_required': return 'Independent proof not required';
    case 'unavailable': return 'Manager proof unavailable';
  }
}
