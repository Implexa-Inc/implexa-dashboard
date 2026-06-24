/**
 * <GradeBadge /> — the proof-layer grade, the moat made visible.
 *
 * "Graded on what actually happened on real runs, not fake AI scoring." Shows the
 * delivery rate + a plain label, with the run count so the number is honest (a
 * high rate on 2 runs reads differently than on 55). Renders nothing when there
 * isn't a real grade yet (the index refuses to flatter a thin history).
 */

type Grade = { hasGrade: boolean; rate: number; label: 'reliable' | 'mixed' | 'unproven'; runs: number; confidence: number } | null | undefined;

const TONE: Record<string, string> = {
  reliable: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.07]',
  mixed: 'text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/[0.07]',
  unproven: 'text-ink-400 border-ink-700 bg-ink-900/40',
};

export default function GradeBadge({ grade, className = '' }: { grade: Grade; className?: string }) {
  if (!grade || !grade.hasGrade) return null;
  const pct = Math.round(grade.rate * 100);
  const tone = TONE[grade.label] || TONE.unproven;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}
      title={`Delivered ${pct}% across ${grade.runs} real run${grade.runs === 1 ? '' : 's'} (graded on what actually happened, not a benchmark)`}
    >
      ✓ delivered {pct}%
      <span className="opacity-70 font-normal">· {grade.runs} run{grade.runs === 1 ? '' : 's'}</span>
    </span>
  );
}
