/**
 * lib/live-feed.ts — reading /scheduled-skills/live WITHOUT laundering an
 * unreadable answer into an empty one.
 *
 * THE THIRD VARIANT OF ONE BUG (2026-07-24 review). Home's "Nothing needs you"
 * may only be claimed when every source was actually read. Two paths that could
 * fake "read it, nothing there" have already been closed: the initial
 * not-yet-loaded state, and the fetch-threw state. This closes the last one —
 * a SUCCESSFUL response whose body isn't what we expect.
 *
 * `callBackend` only throws on a non-2xx status. It returns `parsed`, which is
 * `null` when the body was empty or not JSON. So all of these arrive as an
 * ordinary "success":
 *
 *     null                      (empty or non-JSON 200 body)
 *     {}                        (schema drift — the field went away)
 *     { items: null }           (explicit null)
 *     { items: { … } }          (shape changed from array to object)
 *
 * `Array.isArray(res?.items) ? res.items : []` turned every one of them into a
 * confident empty list, and an empty list is what the all-clear reads. The one
 * thing we actually know in those cases is that we do NOT know.
 *
 * Pure, so the whole matrix is unit-testable without React or a network.
 */

/** null = UNREADABLE (do not treat as empty). An array = genuinely what's live. */
export function parseLiveItems<T = unknown>(res: unknown): T[] | null {
  if (!res || typeof res !== 'object') return null;      // null / non-JSON / scalar body
  const items = (res as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;                 // missing, null, or wrong shape
  return items as T[];
}
