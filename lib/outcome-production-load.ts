/**
 * lib/outcome-production-load.ts — server-side read of one outcome production.
 *
 * Three-valued like lib/agent-discovery.ts: `ok` | `not_found` | `unavailable`.
 * A 200 whose body drifts off the contract is UNAVAILABLE, not empty — the
 * monitor must say "we can't show this production", never render a confident
 * blank ([[parseLiveItems discipline]]).
 */

import { BackendError, callBackend } from './api.ts';
import {
  parseProductionResponse, parseReceiptResponse,
  type Production, type ProductionReceipt,
} from './outcome-production.ts';

export type OutcomeProductionLoad =
  | { status: 'ok'; production: Production; receipt: ProductionReceipt | null }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

export async function loadOutcomeProduction(productionId: string, jwt: string): Promise<OutcomeProductionLoad> {
  let production: Production | null;
  try {
    const response = await callBackend(`/api/v2/outcome-productions/${encodeURIComponent(productionId)}`, { jwt });
    production = parseProductionResponse(response);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return { status: 'not_found' };
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'The production is unavailable.' };
  }
  if (!production) return { status: 'unavailable', reason: 'The production response did not match the contract.' };

  // The receipt exists only once the parent settles. Anything other than a
  // clean contracted answer keeps the receipt off the page — the production
  // itself still renders.
  let receipt: ProductionReceipt | null = null;
  if (production.state === 'completed') {
    try {
      const response = await callBackend(`/api/v2/outcome-productions/${encodeURIComponent(productionId)}/receipt`, { jwt });
      receipt = parseReceiptResponse(response);
      if (!receipt) return { status: 'unavailable', reason: 'The production receipt did not match the contract.' };
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : 'The production receipt is unavailable.' };
    }
  }
  return { status: 'ok', production, receipt };
}
