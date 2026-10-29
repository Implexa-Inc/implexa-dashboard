import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import NewReview from './new-review';

export const dynamic = 'force-dynamic';

/**
 * /review/new — "New review" (Review Room recording spec §3.1). NET NEW.
 *
 * Three ways in: an Agent result (today's review list in Work), a video uploaded into
 * the local recordings library, or a new recording. Below them, the library itself.
 * The recordings live on this Mac and are reached only through Implexa Desktop, so the
 * page is a client component over the desktop bridge; auth is the (dashboard) layout's.
 *
 * `/review` itself is unchanged (it still redirects into Work), and `/review/[runId]`
 * is unaffected: this static segment takes precedence over the dynamic one, and run ids
 * are UUIDs, never "new".
 */
export default async function NewReviewPage({searchParams}:{searchParams?:{trainingSlug?:string}}) {
  const {data:{user}}=await createClient().auth.getUser();
  if(!user)redirect('/login');
  const trainingSlug=searchParams?.trainingSlug;
  if(trainingSlug!==undefined&&!/^[a-zA-Z0-9_-]{1,200}$/.test(trainingSlug))return <main>Training context unavailable.</main>;
  return <NewReview ownerId={user.id} trainingSlug={trainingSlug}/>;
}
