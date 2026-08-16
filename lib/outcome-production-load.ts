/**
 * lib/outcome-production-load.ts — server-side reads of outcome productions.
 *
 * Three-valued like lib/agent-discovery.ts: `ok` | `not_found` | `unavailable`.
 * A 200 whose body drifts off the contract is UNAVAILABLE, not empty — the
 * monitor must say "we can't show this production", never render a confident
 * blank ([[parseLiveItems discipline]]).
 *
 * The production and its receipt are read INDEPENDENTLY. They are two facts
 * with two failure modes, and collapsing them means a receipt that is merely
 * late hides a production that read perfectly.
 */

import { BackendError, callBackend } from './api.ts';
import {
  parseProductionListResponse, parseProductionResponse, parseReceiptResponse,
  type Production, type ProductionReceipt,
} from './outcome-production.ts';

/**
 * - `ready`       the receipt is here.
 * - `none`        the production has not settled, so no receipt exists yet.
 * - `pending`     settled, but the backend has no receipt for it YET (the
 *                 settle and the receipt write are not one instant).
 * - `unavailable` we could not read or could not understand the receipt.
 */
export type ReceiptStatus = 'ready' | 'none' | 'pending' | 'unavailable';

export type OutcomeProductionLoad =
  | { status: 'ok'; production: Production; receipt: ProductionReceipt | null; receiptStatus: ReceiptStatus }
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

  // Settlement is the backend's own flag, never inferred from the state string:
  // a stopped or failed production settles too, and its receipt is the only
  // account of what was spent and what came back.
  if (!production.settled) return { status: 'ok', production, receipt: null, receiptStatus: 'none' };

  try {
    const response = await callBackend(`/api/v2/outcome-productions/${encodeURIComponent(productionId)}/receipt`, { jwt });
    const receipt = parseReceiptResponse(response);
    // The production itself read cleanly, so it RENDERS either way. A missing
    // or drifted receipt is reported as its own gap rather than blanking a page
    // that can already answer "what happened".
    if (!receipt) return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };
    return { status: 'ok', production, receipt, receiptStatus: 'ready' };
  } catch (error) {
    const late = error instanceof BackendError && error.status === 404;
    return { status: 'ok', production, receipt: null, receiptStatus: late ? 'pending' : 'unavailable' };
  }
}

export type OutcomeProductionListLoad =
  | { status: 'ready'; productions: Production[] }
  | { status: 'unavailable'; reason: string };

/**
 * Every outcome production the owner has, newest first.
 *
 * Without this, a started production is reachable only from the redirect that
 * created it — navigate away and the running work, its budget, and its one
 * stop control are gone.
 */
export async function listOutcomeProductions(jwt: string): Promise<OutcomeProductionListLoad> {
  try {
    const response = await callBackend('/api/v2/outcome-productions', { jwt });
    const productions = parseProductionListResponse(response);
    if (!productions) return { status: 'unavailable', reason: 'The productions response did not match the contract.' };
    return { status: 'ready', productions };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Your productions are unavailable.' };
  }
}
