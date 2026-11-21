import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MarketplaceSubmission from '../marketplace-submission';

export const dynamic = 'force-dynamic';

export default async function MarketplaceListingPage({params,searchParams}:{params:{slug:string};searchParams?:{versionId?:string}}) {
 const supabase=createClient();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/login');
 const expectedVersion=searchParams?.versionId;
 if(expectedVersion&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedVersion))return <main className="app-page"><div className="app-content"><header className="app-page-head"><h1>Listing link unavailable</h1></header><Link href={`/training/${encodeURIComponent(params.slug)}`} className="btn-outline">Return to Coach</Link></div></main>;
 // The existing owner-scoped context endpoint still authorizes the agent and
 // pins its active version. This page grants no listing or publication access.
 return <main className="app-page"><div className="app-content">
  <Link href={`/training/${encodeURIComponent(params.slug)}`} className="text-sm text-ink-400">← Back to Coach</Link>
  <header className="app-page-head mt-7"><div><h1>Prepare your listing</h1><p className="app-page-description">Describe what your agent offers, choose real samples, and review how customers access its tools.</p></div></header>
  <MarketplaceSubmission slug={params.slug} versionId={expectedVersion||null}/>
 </div></main>;
}
