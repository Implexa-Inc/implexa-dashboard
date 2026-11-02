'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import type {RunSummary, RunSummaryCursor, RunSummaryPage} from '@/lib/run-state';

function name(slug: string) { return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
export default function CompletedRunResults({revision = 0}: {revision?: number}) {
 const [rows, setRows] = useState<RunSummary[]>([]);
 const [cursor, setCursor] = useState<RunSummaryCursor | null>(null);
 const [loading, setLoading] = useState(true);
 const [failed, setFailed] = useState(false);
 const [loaded, setLoaded] = useState(false);
 const sequence = useRef(0);
 const retryCursor = useRef<RunSummaryCursor | null>(null);
 async function load(next: RunSummaryCursor | null = null) {
  const request = ++sequence.current;
  retryCursor.current = next;
  setLoading(true); setFailed(false);
  try {
   const params = next ? `?${new URLSearchParams({before: next.ranAt, id: next.id})}` : '';
   const response = await fetch(`/api/runs/summary${params}`, {cache: 'no-store'});
   if (!response.ok) throw new Error('unavailable');
   const page: RunSummaryPage = await response.json();
   if (request !== sequence.current) return;
   setRows(previous => next ? [...previous, ...page.rows.filter(row => !previous.some(old => old.id === row.id))] : page.rows);
   setCursor(page.nextCursor); setLoaded(true);
  } catch { if (request === sequence.current) setFailed(true); }
  finally { if (request === sequence.current) setLoading(false); }
 }
 useEffect(() => { void load(); return () => { sequence.current++; }; }, [revision]); // no history timer
 const groups = new Map<string, RunSummary[]>();
 for (const row of rows) {
  const date = new Date(row.ran_at).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  groups.set(date, [...(groups.get(date) ?? []), row]);
 }
 return <section className="mt-10 border-t border-ink-800 pt-6" aria-label="Completed results">
  <div className="flex items-center justify-between gap-3 mb-5"><h2 className="text-lg font-medium text-ink-100">Completed</h2><Link href="/runs" prefetch={false} className="text-xs text-ink-400 hover:text-ink-100">Full history →</Link></div>
  {[...groups].map(([date, results]) => <div key={date} className="mb-5"><h3 className="mb-2 text-xs text-ink-500">{date}</h3><ul className="divide-y divide-ink-800">{results.map(row => <li key={row.id} className="flex items-center gap-3 py-3">
   <span aria-hidden="true" className={`h-2 w-2 rounded-full shrink-0 ${row.status==='partial'?'bg-amber-400':'bg-emerald-400'}`}/>
   <Link href={`/runs/${encodeURIComponent(row.id)}`} prefetch={false} className="min-w-0 flex-1 text-sm text-ink-100 hover:underline"><span className="block truncate">{name(row.skill_slug)}</span>{row.status==='partial'&&<span className="text-xs text-amber-300">Partially delivered</span>}</Link>
   <Link href={`/runs/${encodeURIComponent(row.id)}`} prefetch={false} className="shrink-0 text-xs text-ink-300 hover:text-brand-400">View results →</Link>
  </li>)}</ul></div>)}
  {loading && <p role="status" className="text-sm text-ink-500">Loading results…</p>}
  {failed && <p role="status" className="text-sm text-amber-300">Couldn’t load results. <button onClick={() => void load(retryCursor.current)} className="underline">Try again</button></p>}
  {loaded && !loading && !failed && rows.length===0 && <p className="text-sm text-ink-500">No completed results on this page.</p>}
  {cursor && !loading && !failed && <button onClick={() => void load(cursor)} className="text-sm text-ink-300 hover:text-brand-400">More ↓</button>}
 </section>;
}
