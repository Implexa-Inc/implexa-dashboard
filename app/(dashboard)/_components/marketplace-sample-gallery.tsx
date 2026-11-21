'use client';
import {useState} from 'react';
import Link from 'next/link';
import type {MarketplaceSample} from '@/lib/agent-marketplace-samples';
import type {ApprovedRead} from '@/lib/approved-marketplace-listings';
import type {AgentDiscoveryResult} from '@/lib/agent-discovery';
import {categorizeAgent} from '@/lib/agent-category';
import Modal from './modal';
import RetryButton from './retry-button';

/** One searchable catalog, retaining the existing admitted and listing contracts. */
export default function MarketplaceSampleGallery({listings,approved={status:'ready',listings:[]},discovery={status:'ready',agents:[]}}:{listings:MarketplaceSample[];approved?:ApprovedRead;discovery?:AgentDiscoveryResult}){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[view,setView]=useState<'gallery'|'list'>('gallery');
 const [sample,setSample]=useState<MarketplaceSample|null>(null);
 const actual=approved.status==='ready'?approved.listings:[];
 const realSlugs=new Set(actual.map(a=>a.slug));
 const admitted=discovery.status==='ready'?discovery.agents.filter(a=>!realSlugs.has(a.slug)):[];
 const samples=listings.filter(a=>a.artwork!=='video'||approved.status==='ready'&&!actual.length&&!admitted.length);
 const categoryFor=(name:string,category:string)=>{const known=categorizeAgent([name,category]);return known.key==='assistant'&&category.trim()?{key:category.trim().toLowerCase(),label:category.trim()}:known;};
 const categories=new Map<string,string>();
 for(const a of [...actual,...samples]){const c=categoryFor(a.name,a.category);categories.set(c.key,c.label);}
 for(const a of admitted){const c=categoryFor(a.name,a.job);categories.set(c.key,c.label);}
 const needle=query.trim().toLowerCase();
 const matches=(name:string,cat:string,words:string[])=> (category==='all'||categoryFor(name,cat).key===category)&&(!needle||[name,cat,...words].join(' ').toLowerCase().includes(needle));
 const shownActual=actual.filter(a=>matches(a.name,a.category,[a.output,a.input,a.studioName]));
 const shownAdmitted=admitted.filter(a=>matches(a.name,a.job,[a.builder.name,...a.capabilities||[]]));
 const shownSamples=samples.filter(a=>matches(a.name,a.category,[a.outcome,a.input,a.owner.handle]));
 const count=shownActual.length+shownAdmitted.length+shownSamples.length;
 const art=<div className="marketplace-card-art" aria-hidden="true"><svg><use href="/brand/tukido-icons.svg#agents"/></svg></div>;
 return <section className="marketplace-collection" aria-label="Find a trained agent">
  <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="What do you need done? For example: turn my podcast into Shorts" aria-label="Search trained agents" className="input"/>
  <nav className="agent-filter-chips" aria-label="Agent categories"><button type="button" aria-pressed={category==='all'} onClick={()=>setCategory('all')}>All</button>{Array.from(categories,([key,label])=><button key={key} type="button" aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}</nav>
  <div className="agent-section-head"><h2>Trained by experts</h2><div className="marketplace-view" aria-label="Listing view">{(['gallery','list'] as const).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>setView(v)}>{v==='gallery'?'Gallery':'List'}</button>)}</div></div>
  {(approved.status==='unavailable'||discovery.status==='unavailable')&&<p role="status" className="mb-5 text-sm text-state-needs">Some trained agents couldn’t be loaded. Known listings are shown below. <RetryButton/></p>}
  {count>0&&<div className="marketplace-grid" data-view={view}>
   {shownActual.map(a=><article className="marketplace-card" key={a.id}>{art}<div className="marketplace-card-body"><h3><Link href={`/workflows/${encodeURIComponent(a.slug)}?source=generated`}>{a.name}</Link></h3><p>{a.output}</p><p className="marketplace-meta">You provide: {a.input}</p><p className="marketplace-trainer">Trained by {a.studioName}</p><p className="marketplace-meta">{a.sampleCount} approved {a.sampleCount===1?'sample':'samples'}</p><div className="marketplace-card-footer"><span>${(a.servicePriceCents/100).toFixed(2)}/{a.pricePeriod==='per_run'?'run':'month'} <small>planned price</small></span><Link href={`/workflows/${encodeURIComponent(a.slug)}?source=generated`} className="btn-outline">View agent</Link></div><small className="marketplace-meta">Check the tools you’ll need before you start.</small></div></article>)}
   {shownAdmitted.map(a=><article className="marketplace-card" key={a.id}>{art}<div className="marketplace-card-body"><h3><Link href={`/workflows/${encodeURIComponent(a.slug)}`}>{a.name}</Link></h3><p>{a.job}</p><p className="marketplace-trainer">Trained by {a.builder.name}</p>{a.audition&&a.audition.allowance>0&&<p className="marketplace-meta">Free trial offered. Your tool costs still apply.</p>}<Link href={`/workflows/${encodeURIComponent(a.slug)}`} className="btn-outline">View agent</Link></div></article>)}
   {shownSamples.map(a=><article className="marketplace-card" key={a.slug}>{art}<div className="marketplace-card-body"><span className="marketplace-meta">Sample listing</span><h3>{a.name}</h3><p>{a.outcome}</p><p className="marketplace-meta">You provide: {a.input}</p><p className="marketplace-trainer">Sample trainer · {a.owner.handle}</p><button type="button" onClick={()=>setSample(a)} className="btn-outline">Preview sample</button></div></article>)}
   <aside className="marketplace-build-card"><h3>Build yours, free</h3><p>Describe the work you want done. We’ll work out the steps together.</p><Link href="/create" className="btn-outline">Describe the job →</Link></aside>
  </div>}
  {!count&&approved.status==='ready'&&discovery.status==='ready'&&<div className="collection-empty"><h3>No results</h3><p>{needle||category!=='all'?`No trained agents match${needle?` “${query.trim()}”`:''}${category!=='all'?` in ${categories.get(category)||category}`:''}.`:'No trained agents are listed yet. When trainers publish agents they appear here.'}</p>{(needle||category!=='all')&&<button type="button" className="btn-outline" onClick={()=>{setQuery('');setCategory('all');}}>Clear search and filters</button>}</div>}
  <Modal open={!!sample} onClose={()=>setSample(null)} title={sample?.name||'Sample listing'}>{sample&&<div className="space-y-4 text-sm"><p>Sample listing · illustrative, not available to run.</p><p>{sample.outcome}</p><p>You provide: {sample.input}</p><button type="button" onClick={()=>setSample(null)} className="btn-outline">Done</button></div>}</Modal>
 </section>;
}
