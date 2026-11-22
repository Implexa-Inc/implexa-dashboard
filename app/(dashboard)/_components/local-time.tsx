'use client';
import {useEffect,useState} from 'react';

/** Compact relative time; a short date for older work. Stable UTC first paint avoids hydration drift. */
export default function LocalTime({iso}:{iso:string}) {
 const [local,setLocal]=useState<string|null>(null);
 const valid=Number.isFinite(Date.parse(iso));
 useEffect(()=>{
  if(!valid)return;
  const update=()=>{
   const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(iso))/60_000));
   setLocal(minutes<1?'just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} h ago`:minutes<4320?`${Math.floor(minutes/1440)} d ago`:new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'}));
  };
  update();const timer=window.setInterval(update,60_000);return()=>clearInterval(timer);
 },[iso,valid]);
 if(!valid)return <span>Time unavailable</span>;
 const initial=new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
 return <time dateTime={iso} title={new Date(iso).toISOString()}>{local??initial}</time>;
}
