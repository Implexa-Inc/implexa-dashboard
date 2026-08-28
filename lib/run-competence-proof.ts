export type CompetenceContextStatus = 'ready' | 'none' | 'unavailable';
export type CompetenceSupplyStatus = 'supplied' | 'not_recorded' | 'unavailable' | 'not_required';
export type CompetenceHandlingStatus = 'ready' | 'not_recorded' | 'incomplete' | 'unavailable' | 'not_required';

export type FrozenStageSkill = {
  skillId: string;
  source: string;
  slug: string;
  contentDigest: string;
  stages: number[];
};

export type StageSkillHandlingReceipt = {
  receiptId: string;
  skillId: string;
  source: string;
  slug: string;
  contentDigest: string;
  handling: 'applied' | 'skipped_inapplicable' | 'unavailable' | 'refused';
  stages: number[];
  reason: string;
  evidenceBinding: Record<string, unknown>;
  reportDigest: string;
  causationClaim: 'not_claimed';
  createdAt: string;
};

/** Bindings prove supply only; receipts separately report executor handling. */
export type StageCompetenceProof = {
  contextStatus: CompetenceContextStatus;
  unavailableReason?: 'identity_missing' | 'context_read_failed' | 'context_malformed';
  handlingUnavailableReason?: string;
  supplyUnavailableReason?: string;
  attemptContextId: string | null;
  contextDigest: string | null;
  workflowVersionId: string | null;
  bindings: FrozenStageSkill[];
  supplyStatus: CompetenceSupplyStatus;
  handlingStatus: CompetenceHandlingStatus;
  receipts: StageSkillHandlingReceipt[];
};

export const COMPETENCE_PROOF_UNAVAILABLE: StageCompetenceProof = {
  contextStatus: 'unavailable',
  unavailableReason: 'context_read_failed',
  attemptContextId: null,
  contextDigest: null,
  workflowVersionId: null,
  bindings: [],
  supplyStatus: 'unavailable',
  handlingStatus: 'unavailable',
  receipts: [],
};

export function stageSkillStatus(
  skill: FrozenStageSkill,
  proof: StageCompetenceProof,
): { label: string; detail: string; tone: 'neutral' | 'positive' | 'warning' } {
  const receipt = proof.receipts.find((item) => item.skillId === skill.skillId);
  if (proof.handlingStatus === 'unavailable') {
    return {
      label: 'Execution receipt unavailable',
      detail: 'The immutable binding is frozen, but its executor handling receipt could not be read. No execution is inferred.',
      tone: 'warning',
    };
  }
  if (!receipt) {
    return {
      label: proof.handlingStatus === 'not_required' ? 'Execution not required' : 'Execution receipt not recorded',
      detail: proof.handlingStatus === 'not_required'
        ? 'This run did not require an executor handling report.'
        : proof.supplyStatus === 'supplied'
          ? 'Supply is verified; execution is not claimed without a matching handling receipt.'
          : 'The binding is frozen, but supply and execution are not claimed without their matching receipts.',
      tone: proof.handlingStatus === 'not_required' ? 'neutral' : 'warning',
    };
  }
  return {
    label: receipt.handling.replaceAll('_', ' '),
    detail: receipt.reason || 'The executor did not provide an additional reason.',
    tone: receipt.handling === 'applied' ? 'positive' : 'neutral',
  };
}

export function competenceSupplyLabel(proof: StageCompetenceProof): string {
  switch (proof.supplyStatus) {
    case 'supplied': return 'supply verified';
    case 'not_recorded': return 'supply receipt not recorded';
    case 'unavailable': return 'supply receipt unavailable';
    case 'not_required': return 'supply not required';
  }
}

export function competenceEmptyCopy(proof: StageCompetenceProof): string {
  if (proof.contextStatus === 'unavailable') {
    return 'Stage-skill proof is unavailable. This does not mean skills were absent or unused.';
  }
  if (proof.contextStatus === 'none' || proof.bindings.length === 0) {
    return 'No stage skill bindings were frozen in this run context. Learnings are reported separately below.';
  }
  return '';
}
