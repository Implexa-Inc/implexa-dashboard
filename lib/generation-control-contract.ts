/**
 * lib/generation-control-contract.ts — WHICH control contract a proposal
 * document declares. One field, read exactly, and nothing else.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD
 *
 * v2 is NEVER inferred from payload shape. A document that happens to carry
 * `professional_control.moments[].judge_mode`, `variants_requested`,
 * `initial_credits`, or a 40-task graph is still a v1 document unless it SAYS
 * `control_contract_version: "professional-generation-control.v2"`. Inference
 * would make the contract a function of payload details that can vary by
 * accident, and would route a document nobody declared as v2 into the wider
 * parser — the exact failure the discriminator exists to prevent. It mirrors the
 * backend's own `selectControlContract`, which reads one explicit request field
 * and refuses to guess from the moments it is carrying.
 *
 * ABSENCE means v1, because every proposal compiled before this field existed is
 * a v1 proposal and must keep rendering. But only GENUINE absence: `null`, `""`,
 * `"  "`, and `" professional-generation-control.v2"` are a producer that SENT
 * the field and sent something meaningless. Treating those as absence silently
 * renders a Professional v2 plan through the v1 parser — the quiet downgrade this
 * discriminator exists to prevent. Exact literals only, not trimmed, not
 * lowercased, not coerced: the same posture as the backend's server-flag gate.
 */

import { CONTROL_V1, CONTROL_V2 } from './professional-v2-contract.ts';

export type ControlContractRead =
  | { kind: 'v1' }
  | { kind: 'v2' }
  | { kind: 'malformed'; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read the discriminator off a compiled proposal document.
 *
 * Note what is NOT consulted: task shape, moment fields, credit fields, graph
 * contract_version. The embedded graph's own `contract_version` is checked LATER,
 * by the v2 parser, as an agreement test — a document whose envelope and graph
 * disagree is mixed identity and is refused there. It is never used to decide
 * routing, because then a forged graph would choose its own parser.
 */
export function readControlContractVersion(document: unknown): ControlContractRead {
  if (!isObject(document)) return { kind: 'malformed', reason: 'not_an_object' };
  if (!('control_contract_version' in document) || document.control_contract_version === undefined) {
    return { kind: 'v1' };
  }
  const declared = document.control_contract_version;
  if (declared === CONTROL_V2) return { kind: 'v2' };
  if (declared === CONTROL_V1) return { kind: 'v1' };
  return { kind: 'malformed', reason: 'unknown_control_contract_version' };
}

/**
 * The v2-only fields, named so a v1 document carrying any of them is rejected as
 * MIXED IDENTITY rather than parsed as v1 with extras.
 *
 * The v1 parser tolerates unknown additive fields on purpose, and that is right
 * for genuinely unknown fields. These are not unknown: they are known fields of
 * the OTHER arm. A document that omits the discriminator while carrying v2's
 * cost decomposition is either forged or a producer bug, and rendering it as a
 * v1 proposal would show a Quick-shaped card for a Professional v2 plan.
 */
const V2_ONLY_FIELDS = ['execution_mode', 'initial_credits', 'repair_reserve_credits'] as const;

/** The v1-only fields, for the same reason in the other direction. */
const V1_ONLY_FIELDS = ['stages', 'density_policy', 'per_task_credits', 'review_requirements', 'tasks', 'pins'] as const;

export type ContractRoute =
  | { contract: 'v1'; document: Record<string, unknown> }
  | { contract: 'v2'; document: Record<string, unknown> }
  | { contract: 'malformed'; reason: string };

/**
 * Route a compiled proposal document to its parser, refusing anything that
 * claims two identities at once.
 *
 * This runs BEFORE either parser, so neither has to know the other exists and
 * neither can be reached by a document that did not declare it.
 */
export function routeProposalDocument(document: unknown): ContractRoute {
  const read = readControlContractVersion(document);
  if (read.kind === 'malformed') return { contract: 'malformed', reason: read.reason };
  const doc = document as Record<string, unknown>;
  if (read.kind === 'v1') {
    const borrowed = V2_ONLY_FIELDS.filter((field) => field in doc);
    if (borrowed.length) return { contract: 'malformed', reason: `v1_document_carries_v2_fields:${borrowed.join(',')}` };
    return { contract: 'v1', document: doc };
  }
  const borrowed = V1_ONLY_FIELDS.filter((field) => field in doc);
  if (borrowed.length) return { contract: 'malformed', reason: `v2_document_carries_v1_fields:${borrowed.join(',')}` };
  return { contract: 'v2', document: doc };
}
