import {redirect} from 'next/navigation';
/** Replaced by the agent Setup tab; completion retains the existing activation writer. */
export default function ActivateAgentPage({params}:{params:{slug:string}}){
  redirect(`/workflows/${encodeURIComponent(params.slug)}?legacy=1&tab=setup`);
}
