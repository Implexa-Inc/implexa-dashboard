/**
 * lib/review-chronology.ts — WHICH file an issue belongs to, and WHERE inside it.
 *
 * THE BUG THIS EXISTS TO KILL. The rail sorted every issue by its anchor timestamp
 * across the whole run (`sortIssues`), as though Chapter1, Chapter2 and Chapter3 shared
 * one clock. A 00:05 note on Chapter3 therefore rendered ABOVE a 00:40 note on
 * Chapter1, and the reviewer read the two as a single chronology. They are three
 * chronologies. A file-local timestamp is only meaningful next to its own file.
 *
 * So ordering here is two-level and the levels never mix:
 *
 *   PRIMARY   artifact identity — the backend's explicit order when it supplies one,
 *             otherwise NATURAL filename order (Chapter2 before Chapter10, which
 *             lexicographic sorting gets backwards).
 *   SECONDARY inside one artifact only — start timestamp, then end timestamp, then
 *             the issue id.
 *
 * Two invariants are load-bearing and each has a mutation guarding it:
 *
 *   GROUPING IS BY ARTIFACT ID, NEVER BY DISPLAY NAME. Two artifacts can carry the
 *   same relative path. Merging them on the name would pool issues written against
 *   different bytes under one heading, and clicking one would seek the wrong file.
 *
 *   THE ORDER IS TOTAL. Every comparison ends in an id tiebreak, so "equal timestamps
 *   remain stable" is a guarantee rather than an accident of database row order.
 */

export type ChronoIssue = {
  id: string;
  artifactId?: string | null;
  anchor?: Record<string, unknown> | null;
  status?: string;
};

export type ChronoArtifact = {
  id: string;
  relativePath?: string;
  /**
   * The backend's EXPLICIT artifact order, which wins over filename order when
   * present. No such field exists at backend main (cc6ab71), so natural filename
   * order governs today; this is read defensively rather than assumed, so the rail
   * adopts a real order the moment one is served instead of needing a code change.
   */
  ordinal?: number | null;
};

/** Shown when an issue names an artifact this packet does not contain. */
export const UNAVAILABLE_FILE_LABEL = 'Unavailable file';
/** Shown for a comment about the run rather than about any one file. */
export const WHOLE_RUN_LABEL = 'Whole run';

const DIGITS_OR_NOT = /(\d+|\D+)/g;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Natural filename order: Chapter1 < Chapter2 < Chapter10.
 *
 * Lexicographic comparison puts Chapter10 second because '1' < '2' one character in,
 * which is exactly the ordering users read as broken once a run passes nine files.
 * Digit runs are therefore compared as NUMBERS and everything else as text.
 *
 * Returns a TOTAL order: distinct strings never compare equal, so it can be the final
 * word on group order without a hidden dependency on input sequence.
 */
export function naturalCompare(a: string, b: string): number {
  const ax = String(a ?? '').match(DIGITS_OR_NOT) ?? [];
  const bx = String(b ?? '').match(DIGITS_OR_NOT) ?? [];
  const shared = Math.min(ax.length, bx.length);

  for (let i = 0; i < shared; i += 1) {
    const as = ax[i];
    const bs = bx[i];
    const bothNumeric = /^\d/.test(as) && /^\d/.test(bs);

    if (bothNumeric) {
      const av = Number(as);
      const bv = Number(bs);
      if (av !== bv) return av < bv ? -1 : 1;
      // Same VALUE, different spelling ("01" vs "1"). Falling through to the next
      // chunk would let two different filenames compare equal at every level and
      // land back on input order.
      if (as !== bs) return as < bs ? -1 : 1;
      continue;
    }

    // Case-insensitive first so `chapter2` and `Chapter10` still order by number
    // rather than by the accident of an uppercase letter sorting before lowercase.
    const al = as.toLowerCase();
    const bl = bs.toLowerCase();
    if (al !== bl) return al < bl ? -1 : 1;
    if (as !== bs) return as < bs ? -1 : 1;
  }

  if (ax.length !== bx.length) return ax.length < bx.length ? -1 : 1;
  return 0;
}

/** The explicit order the backend supplied, or null when it supplied none. */
function explicitOrdinal(a: ChronoArtifact): number | null {
  const v = a?.ordinal;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The heading a file group prints. Never used as the grouping key. */
export function artifactDisplayName(a: ChronoArtifact | null | undefined): string {
  const p = a?.relativePath;
  return typeof p === 'string' && p.trim().length ? p : UNAVAILABLE_FILE_LABEL;
}

/**
 * Group order. An explicit backend order wins outright; artifacts carrying one are
 * placed ahead of artifacts that do not, so a partial order still produces a stable
 * rail instead of interleaving two different ordering systems.
 */
export function compareArtifactsForRail(a: ChronoArtifact, b: ChronoArtifact): number {
  const ao = explicitOrdinal(a);
  const bo = explicitOrdinal(b);
  if (ao !== null && bo !== null) {
    if (ao !== bo) return ao < bo ? -1 : 1;
  } else if (ao !== null) {
    return -1;
  } else if (bo !== null) {
    return 1;
  }

  const byName = naturalCompare(artifactDisplayName(a), artifactDisplayName(b));
  if (byName !== 0) return byName;
  // Duplicate display names stay DISTINCT and adjacent, in a deterministic order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * An issue's position INSIDE its own file: anchor kind, then start, then end.
 *
 * The kind rank keeps mixed-anchor files readable (timed notes, then pages, then text
 * selections, then whole-file remarks) without ever comparing a millisecond against a
 * character offset as if they were the same quantity.
 */
function localKey(i: ChronoIssue): [number, number, number] {
  const a = (i?.anchor ?? {}) as Record<string, unknown>;
  // Mirrors the backend's anchorSortKey: a v2 spatial anchor WITH a time sorts among
  // the temporal anchors by its frozen startMs; an image pin takes the fractional
  // group after text selections so the existing 0..3 groups never renumber.
  if (a.version === 2 && a.type === 'visual_spatial') {
    const t = a.temporal && typeof a.temporal === 'object' ? (a.temporal as Record<string, unknown>) : null;
    if (t) {
      const start = num(t.startMs);
      return [0, start, start];
    }
    return [2.5, 0, 0];
  }
  if (a.type === 'media_time') {
    const start = num(a.timeStartMs);
    // A point comment has no end. Reusing its START keeps it ahead of a RANGE that
    // opens at the same instant; letting null coerce to 0 would instead sort every
    // point comment to the top of the file.
    const end = a.timeEndMs === null || a.timeEndMs === undefined ? start : num(a.timeEndMs);
    return [0, start, end];
  }
  if (a.type === 'pdf_text') {
    const p = num(a.page);
    return [1, p, p];
  }
  if (a.type === 'text_selection') return [2, num(a.startOffset), num(a.endOffset)];
  return [3, 0, 0];
}

/**
 * Order two issues KNOWN to belong to the same artifact.
 *
 * Exported so the rule is executable on its own: applying it across artifacts is the
 * original bug, and a test can prove the grouping never does.
 */
export function compareIssuesWithinArtifact(x: ChronoIssue, y: ChronoIssue): number {
  const [xk, xs, xe] = localKey(x);
  const [yk, ys, ye] = localKey(y);
  if (xk !== yk) return xk < yk ? -1 : 1;
  if (xs !== ys) return xs < ys ? -1 : 1;
  if (xe !== ye) return xe < ye ? -1 : 1;
  // The stable, total tiebreak. Two issues at an identical timestamp otherwise fall
  // back to array order, which is database row order, which is not stable.
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

export type IssueGroup<I extends ChronoIssue, A extends ChronoArtifact> = {
  /**
   * The grouping identity. `null` ONLY for the whole-run group; an issue naming an
   * artifact absent from the packet keeps its id and groups alone, because merging it
   * into "whole run" would claim it was never about a file.
   */
  artifactId: string | null;
  /** The packet's artifact row, or null when the packet does not contain it. */
  artifact: A | null;
  /** Heading text. Two groups may legitimately share one. */
  displayName: string;
  /** Whether this group's artifact is missing from the packet. */
  unavailable: boolean;
  count: number;
  issues: I[];
};

/**
 * The rail's contents: one group per artifact, each internally ordered by its own
 * clock.
 *
 * Callers filter (dismissed issues, proxy previews) BEFORE calling, so `count` is
 * exactly what the sticky header prints and no group can advertise more issues than
 * it renders.
 */
export function groupIssuesByArtifact<I extends ChronoIssue, A extends ChronoArtifact>(
  issues: I[],
  artifacts: A[],
): IssueGroup<I, A>[] {
  const byId = new Map<string, A>();
  for (const a of artifacts ?? []) {
    if (a && a.id != null) byId.set(String(a.id), a);
  }

  // Bucket by ARTIFACT ID. Using the display name here is the duplicate-filename bug.
  const buckets = new Map<string, I[]>();
  const WHOLE_RUN = ' whole-run';
  for (const issue of issues ?? []) {
    const key = issue?.artifactId ? String(issue.artifactId) : WHOLE_RUN;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(issue);
    else buckets.set(key, [issue]);
  }

  const fileGroups: IssueGroup<I, A>[] = [];
  let wholeRun: IssueGroup<I, A> | null = null;

  for (const [key, list] of buckets) {
    const ordered = [...list].sort(compareIssuesWithinArtifact);
    if (key === WHOLE_RUN) {
      wholeRun = {
        artifactId: null, artifact: null, displayName: WHOLE_RUN_LABEL,
        unavailable: false, count: ordered.length, issues: ordered,
      };
      continue;
    }
    const artifact = byId.get(key) ?? null;
    fileGroups.push({
      artifactId: key,
      artifact,
      displayName: artifactDisplayName(artifact),
      unavailable: artifact === null,
      count: ordered.length,
      issues: ordered,
    });
  }

  fileGroups.sort((x, y) => {
    // A group whose artifact is missing has no filename and no ordinal to trust, so
    // it sorts after every real file rather than being ranked on a placeholder label.
    if (x.unavailable !== y.unavailable) return x.unavailable ? 1 : -1;
    if (x.unavailable && y.unavailable) {
      return String(x.artifactId) < String(y.artifactId) ? -1 : 1;
    }
    return compareArtifactsForRail(x.artifact as A, y.artifact as A);
  });

  // Whole-run comments last: they belong to no file, so placing them among files
  // would attach them to whichever heading happened to precede them.
  return wholeRun ? [...fileGroups, wholeRun] : fileGroups;
}

/**
 * The groups' issues as one list, in render order.
 *
 * Exists so a test can assert the FLAT sequence is file-major — the precise property
 * the old global timestamp sort violated.
 */
export function flattenGroupedIssues<I extends ChronoIssue, A extends ChronoArtifact>(
  groups: IssueGroup<I, A>[],
): I[] {
  return groups.flatMap((g) => g.issues);
}

/** `9 issues` / `1 issue` — the count a sticky file header prints. */
export function groupCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'issue' : 'issues'}`;
}
