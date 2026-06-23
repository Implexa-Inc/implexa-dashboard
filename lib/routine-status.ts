// routine-status.ts: coarse "is this routine overdue?" helper for the dashboard.
//
// The authoritative, precise watchdog lives in the backend (N1, tz-aware cron
// math) and drives the daily email. The dashboard reads scheduled_skills
// directly via RLS, so for the at-a-glance UI we derive a generous max interval
// from the cron cadence and flag a routine whose last run is older than that
// plus a grace window. Returns false for cron shapes we do not recognize, so we
// never show a false "overdue".

export function looksOverdue(cron: string, lastRunAt: string | null): boolean {
  const p = (cron || "").trim().split(/\s+/);
  if (p.length !== 5) return false;
  const [m, h, dom, , dow] = p;
  let maxH: number | null = null;
  let mm: RegExpMatchArray | null;
  let hm: RegExpMatchArray | null;
  let dm: RegExpMatchArray | null;
  if ((mm = m.match(/^\*\/(\d+)$/)) && h === "*") maxH = Math.max(1, +mm[1] / 60);
  else if (m === "0" && (hm = h.match(/^\*\/(\d+)$/))) maxH = +hm[1];
  else if (m === "0" && h === "*") maxH = 1;
  else if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
    // Day-of-month interval takes precedence: "*/2" = every 2 days (≈48h), not daily.
    // Without this an every-N-days cron was read as daily and a normal ~35h gap
    // tripped a false "missed its schedule" alert (founder hit this on the SEO chain).
    if ((dm = dom.match(/^\*\/(\d+)$/))) maxH = Math.max(1, +dm[1]) * 24;
    else if (dom !== "*" && /^\d+$/.test(dom)) maxH = 31 * 24; // a specific day each month
    else if (dow === "*") maxH = 24; // daily
    else if (dow === "1-5") maxH = 72; // weekday (covers the weekend gap)
    else if (/^\d+$/.test(dow)) maxH = 168; // weekly
  }
  if (maxH == null) return false;
  if (!lastRunAt) return false; // never-ran is handled by the email watchdog
  const ageH = (Date.now() - new Date(lastRunAt).getTime()) / 3_600_000;
  return ageH > maxH + 6;
}
