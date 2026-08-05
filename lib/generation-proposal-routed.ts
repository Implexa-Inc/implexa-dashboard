/**
 * lib/generation-proposal-routed.ts — read ONE proposal response and hand it to
 * the parser its own document declares.
 *
 * The whole point of this module is that the choice is made in exactly one place
 * and from exactly one field. Below it, the v1 parser and the v2 parser never
 * learn the other exists; above it, a page picks a card from a tagged union
 * rather than sniffing fields.
 *
 * V1 IS UNTOUCHED. `parseGenerationProposalResponse` is called verbatim — same
 * module, same function, same bytes — so "Quick/v1 renders exactly as before" is
 * a structural fact rather than a promise. A v1 document reaches it only after
 * the router has confirmed the discriminator is genuinely ABSENT (or is the
 * explicit v1 literal), and that the document does not also carry v2's fields.
 */

import {
  parseGenerationProposalResponse,
  type GenerationProposalViewModel,
} from './generation-proposal.ts';
import {
  parseProfessionalV2ProposalResponse,
  type ProfessionalV2ProposalViewModel,
} from './generation-proposal-v2-envelope.ts';
import { routeProposalDocument } from './generation-control-contract.ts';

export type RoutedProposalViewModel =
  | { contract: 'v1'; vm: GenerationProposalViewModel }
  | { contract: 'v2'; vm: ProfessionalV2ProposalViewModel };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse GET /api/v2/generation-proposals/:id (and the identical body approve and
 * cancel return), routing on the compiled document's explicit contract version.
 * Null on any violation, including a malformed or mixed-identity discriminator.
 */
export function parseRoutedProposalResponse(
  body: unknown, expectedProposalId?: string,
): RoutedProposalViewModel | null {
  if (!isObject(body)) return null;
  const route = routeProposalDocument(body.proposal);
  if (route.contract === 'malformed') return null;
  if (route.contract === 'v2') {
    const vm = parseProfessionalV2ProposalResponse(body, expectedProposalId);
    return vm ? { contract: 'v2', vm } : null;
  }
  const vm = parseGenerationProposalResponse(body, expectedProposalId);
  return vm ? { contract: 'v1', vm } : null;
}
