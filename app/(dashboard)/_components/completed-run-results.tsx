'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import type {RunSummary, RunSummaryPage} from '@/lib/run-state';
import WorkItemRow from './work-item-row';
import LocalTime from './local-time';

function name(slug:string){return slug.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
/** Three recent results; the existing Delivered filter and calendar own full history. No history polling. */
export default function CompletedRunResults({revision=0,names={}}:{revision?:number;names?:Record<string,string>}) {
 const [rows,setRows]=useState<RunSummary[]>([]);
 const [loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);
 const sequence=useRef(0);
 async function load(){
  const request=++sequence.current;setLoading(true);setFailed(false);
  try{
   const response=await fetch('/api/runs/summary',{cache:'no-store'});
   if(!response.ok)throw new Error('unavailable');
   const page:RunSummaryPage=await response.json();
   if(!Array.isArray(page.rows))throw new Error('malformed');
   if(request!==sequence.current)return;
   setRows(page.rows.slice(0,3));setLoaded(true);
  }catch{if(request===sequence.current)setFailed(true);}
  finally{if(request===sequence.current)setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{sequence.current++;};},[revision]);
 return <section className="work-recent" aria-label="Recently delivered">
  <div className="work-section-head"><h2>Recently delivered</h2><Link href="/work?view=delivered">See all →</Link></div>
  {rows.length>0&&<div className="work-rows">{rows.map(row=><WorkItemRow agentSlug={row.skill_slug} key={row.id} title={names[row.skill_slug]||name(row.skill_slug)} href={`/runs/${encodeURIComponent(row.id)}`}
   detail={row.status==='partial'?'Partly delivered':'Delivered · open to review'} state={row.status==='partial'?'Partly delivered':'Delivered'}
   when={<LocalTime iso={row.ran_at}/>}
   actions={<Link href={`/runs/${encodeURIComponent(row.id)}`} className="work-row-open">Open</Link>}/>)}</div>}
  {loading&&<p role="status" className="work-list-notice">Loading results…</p>}
  {failed&&<p role="status" className="work-list-notice">Couldn’t load results. <button onClick={()=>void load()} className="underline">Try again</button></p>}
  {loaded&&!loading&&!failed&&rows.length===0&&<p className="work-list-notice">No results to display on this page. <Link href="/work?view=delivered" className="underline">See all delivered work</Link></p>}
 </section>;
}
