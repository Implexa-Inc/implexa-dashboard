import {notFound} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import MarketplaceReview from './review';
export const dynamic='force-dynamic';
export default async function Page(){
 const {data:{session}}=await createClient().auth.getSession();
 const allowed=(process.env.NEXT_PUBLIC_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase());
 if(!session?.user.email||!allowed.includes(session.user.email.toLowerCase()))notFound();
 return <main className="mx-auto max-w-4xl px-6 py-10"><a href="/admin" className="text-sm text-ink-400">← Admin</a><h1 className="mt-6 text-3xl font-medium">Review marketplace listings</h1><p className="mt-3 text-sm text-ink-400">Approve a submitted service for the two-account beta. Billing and sample playback are not enabled.</p><MarketplaceReview/></main>;
}
