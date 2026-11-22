'use client';
import {createContext,useCallback,useContext,useLayoutEffect,useEffect,useState,useRef,type ComponentProps,type ReactNode} from 'react';
import {usePathname,useSearchParams} from 'next/navigation';
import {trainingAnnotationHref} from '@/lib/training-annotation-routing';
import TrainingSource from './training-source';
import Modal from '../../_components/modal';
type Props=ComponentProps<typeof TrainingSource>;
const RouteContext=createContext<((props:Props)=>(()=>void))|null>(null);
/** Keep the existing controller (and unsaved/answer refs) through annotation navigation. */
export default function TrainingRouteHost({children}:{children:ReactNode}){
 const pathname=usePathname(),query=useSearchParams();
 const [props,setProps]=useState<Props|null>(null);
 const [active,setActive]=useState(false),lease=useRef<symbol|null>(null),current=useRef<Props|null>(null);
 const [changedVersion,setChangedVersion]=useState(false),[reload,setReload]=useState(false),[controllerKey,setControllerKey]=useState('');
 const register=useCallback((next:Props)=>{
  const id=Symbol();lease.current=id;const previous=current.current;
  const same=!!previous&&previous.ownerId===next.ownerId&&previous.slug===next.slug&&previous.installationId===next.installationId&&(!previous.familyId||!next.familyId||previous.familyId===next.familyId);
  if(same&&previous.runContext?.workflowVersionId&&next.runContext?.workflowVersionId&&previous.runContext.workflowVersionId!==next.runContext.workflowVersionId){
   // Do not remount an old draft onto a new version, or replay it there. Keep
   // the old controller inert until the user deliberately leaves/reloads it.
   setChangedVersion(true);setActive(false);
  }else{
   const accepted=same?{...next,familyId:next.familyId||previous.familyId}:next;
   current.current=accepted;setProps(accepted);setActive(true);setChangedVersion(false);
   if(!same)setControllerKey(`${next.ownerId}:${next.familyId||next.slug}:${next.runContext?.workflowVersionId||'unknown'}:${next.installationId||'owner'}`);
  }
  return()=>{if(lease.current===id)setActive(false);};
 },[]);
 const base=props?`/training/${encodeURIComponent(props.slug)}`:'';
 const editor=!!props&&(pathname===base||pathname.startsWith(base+'/annotate/')||pathname.startsWith(base+'/review/')&&query.get('mode')!=='revise');
 const expected=props?.annotationTarget?new URL(trainingAnnotationHref(props.slug,props.annotationTarget),'https://app.implexa.ai'):null;
 const matched=!!props&&(expected?pathname===expected.pathname&&[...expected.searchParams].every(([key,value])=>query.get(key)===value):pathname===base);
 useEffect(()=>{document.querySelectorAll<HTMLMediaElement>('.training-route-host video,.training-route-host audio').forEach(media=>{if(!media.paused)try{media.pause();}catch{}});},[pathname,query.toString()]);
 return <RouteContext.Provider value={register}>{children}{props&&editor&&changedVersion&&<section role="alert" className="app-page"><div className="app-content"><h1>The agent version changed</h1><p>Your unfinished note is preserved on the earlier version. Nothing has been retried or attached to the new version.</p><button type="button" className="btn-outline mt-4" onClick={()=>setReload(true)}>Review the latest version</button></div></section>}{props&&editor&&<div className="training-route-host" hidden={!active||!matched||changedVersion}><TrainingSource key={controllerKey} {...props}/></div>}<Modal open={reload} onClose={()=>setReload(false)} title="Reload Train for the new version?"><p>Your saved feedback stays in Coach. Any unsaved note on the earlier version will be discarded.</p><button type="button" className="btn-outline mt-4" onClick={()=>setReload(false)}>Keep my unfinished note</button><button type="button" className="btn-danger mt-4" onClick={()=>{if(props)window.location.assign(`/training/${encodeURIComponent(props.slug)}`);}}>Discard unsaved note and reload</button></Modal></RouteContext.Provider>;
}
/** Only authenticated server pages select the controller's presentation and context. */
export function TrainingRouteConfig({value}:{value:Props}){
 const register=useContext(RouteContext);
 useLayoutEffect(()=>register?.(value),[register,value]);
 return register?null:<TrainingSource {...value}/>;
}
