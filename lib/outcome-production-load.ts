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
import {
  parseProductionDetail, parseLineageResponse,
  type ProductionDetail, type ProductionLineage,
} from './outcome-production-detail.ts';

/**
 * - `ready`       the receipt is here.
 * - `none`        the production has not settled, so no receipt exists yet.
 * - `unavailable` settled, but we could not read or could not understand it.
 *
 * There is deliberately no "written soon" state. A 404 from the receipt route
 * means both "not yet" and "this backend has no such route", and the two are
 * indistinguishable from here — so promising the user a receipt is on its way
 * would be a claim about the future with no evidence behind it.
 */
export type ReceiptStatus = 'ready' | 'none' | 'unavailable';

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
  } catch {
    return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };
  }
}

export type OutcomeProductionListLoad =
  | { status: 'ready'; productions: Production[] }
  /**
   * This deployment has no outcome-production list route at all. Distinct from
   * `unavailable` because it is not a fault the user can act on or should be
   * warned about: /work is a shared surface, and an alarming banner about a
   * capability the backend has never offered is noise for every user of it.
   */
  | { status: 'absent' }
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
    // A 404 here is the deployment saying "I have no such route", not "your
    // productions failed to load" — so it renders nothing rather than putting
    // a permanent warning on /work for every user of a feature that does not
    // exist yet.
    if (error instanceof BackendError && error.status === 404) return { status: 'absent' };
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'Your productions are unavailable.' };
  }
}

export type OutcomeProductionDetailLoad =
  | { status: 'ok'; detail: ProductionDetail; receipt: ProductionReceipt | null; receiptStatus: ReceiptStatus }
  | { status: 'not_found' }
  /**
   * This deployment has the monitor route but not the detail one — an older
   * backend. The production still renders from the monitor projection; only
   * the per-agent breakdown is missing, and the page says which.
   */
  | { status: 'absent'; production: Production; receipt: ProductionReceipt | null; receiptStatus: ReceiptStatus }
  | { status: 'unavailable'; reason: string };

/**
 * The Production page's read: ONE bounded server request for the canonical
 * multi-agent view, plus the receipt once the production has settled.
 *
 * Deliberately NOT two reads of the same production. The detail route already
 * returns the whole monitor contract, so asking for /:id as well would double
 * the parent read on every poll to save nothing.
 */
export async function loadOutcomeProductionDetail(
  productionId: string, jwt: string,
): Promise<OutcomeProductionDetailLoad> {
  let body: unknown;
  try {
    body = await callBackend(`/api/v2/outcome-productions/${encodeURIComponent(productionId)}/detail`, { jwt });
  } catch (error) {
    // A 404 is ambiguous between "no such production" and "no such route", and
    // the two must not be conflated: falling back to the monitor read settles
    // it — if THAT answers, the deployment simply predates this page.
    if (error instanceof BackendError && error.status === 404) {
      const fallback = await loadOutcomeProduction(productionId, jwt);
      if (fallback.status === 'ok') {
        return {
          status: 'absent',
          production: fallback.production,
          receipt: fallback.receipt,
          receiptStatus: fallback.receiptStatus,
        };
      }
      return fallback.status === 'not_found'
        ? { status: 'not_found' }
        : { status: 'unavailable', reason: fallback.reason };
    }
    return { status: 'unavailable', reason: error instanceof Error ? error.message : 'The production is unavailable.' };
  }

  const production = parseProductionResponse(body);
  // Distinct wording from loadOutcomeProduction's: the two reads have two
  // failure modes and a reader who sees this needs to know WHICH route drifted.
  if (!production) return { status: 'unavailable', reason: 'The production detail response did not match the contract.' };
  const detail = parseProductionDetail((body as { production?: unknown })?.production, production);
  if (!detail) return { status: 'unavailable', reason: 'The production detail did not match the contract.' };

  if (!detail.settled) return { status: 'ok', detail, receipt: null, receiptStatus: 'none' };
  try {
    const response = await callBackend(`/api/v2/outcome-productions/${encodeURIComponent(productionId)}/receipt`, { jwt });
    const receipt = parseReceiptResponse(response);
    if (!receipt) return { status: 'ok', detail, receipt: null, receiptStatus: 'unavailable' };
    return { status: 'ok', detail, receipt, receiptStatus: 'ready' };
  } catch {
    return { status: 'ok', detail, receipt: null, receiptStatus: 'unavailable' };
  }
}

/**
 * Is this run part of an outcome production, and is it the run the parent
 * considers authoritative?
 *
 * Asked by the run permalink so it can point at the parent rather than present
 * a superseded execution shell as the final result. EVERY failure mode answers
 * `null`: this is an enrichment of an existing page, and a backend without the
 * route, a network blip, or a drifted body must all leave the run page exactly
 * as it was — never break it, and never assert a lineage we could not read.
 */
export async function loadProductionLineage(runId: string, jwt: string): Promise<ProductionLineage | null> {
  try {
    const response = await callBackend(
      `/api/v2/outcome-productions/runs/${encodeURIComponent(runId)}/lineage`, { jwt });
    return parseLineageResponse(response) ?? null;
  } catch {
    return null;
  }
}
