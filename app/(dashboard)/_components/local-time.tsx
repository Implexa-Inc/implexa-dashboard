'use client';
import {useEffect,useState} from 'react';

/** Only the timestamp crosses this client boundary, never a run/deliverable. */
export default function LocalTime({iso}:{iso:string}) {
 const [local,setLocal]=useState<string|null>(null);
 useEffect(()=>setLocal(new Date(iso).toLocaleString('en-US',{
  month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',
 })),[iso]);
 // Deterministic first paint, independent of the server's Intl/locale spacing.
 const utc=new Date(iso).toISOString().slice(0,16).replace('T',' ')+' UTC';
 return <time dateTime={iso}>{local??utc}</time>;
}
