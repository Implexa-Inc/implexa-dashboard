'use client';
import {useLayoutEffect,useState,type RefObject} from 'react';
import {recordingNotePlacement,visualContentRect} from '@/lib/review-spatial-geometry';

type Mark={x:number;y:number;width?:number|null;height?:number|null};
/** Shared #427 placement; narrow/partly offscreen pictures keep notes in normal flow. */
export function useAnnotationNotePlacement(media:RefObject<HTMLVideoElement|HTMLAudioElement|HTMLImageElement>,note:RefObject<HTMLElement>,enabled:boolean,mark:Mark|null,key:unknown){
 const [position,setPosition]=useState<ReturnType<typeof recordingNotePlacement>>(null);
 useLayoutEffect(()=>{
  const picture=media.current,card=note.current;
  if(!enabled||!picture||!card){setPosition(null);return;}
  const place=()=>{
   const rect=picture.getBoundingClientRect();
   const dimensions=picture instanceof HTMLImageElement?{width:picture.naturalWidth,height:picture.naturalHeight}:picture instanceof HTMLVideoElement?{width:picture.videoWidth,height:picture.videoHeight}:null;
   const content=dimensions?.width&&dimensions.height?visualContentRect({elementWidth:rect.width,elementHeight:rect.height,naturalWidth:dimensions.width,naturalHeight:dimensions.height}):null;
   const area=mark&&content?{left:content.left+mark.x*content.width,top:content.top+mark.y*content.height,width:(mark.width||0)*content.width,height:(mark.height||0)*content.height}:null;
   const next=rect.top<16||rect.bottom>window.innerHeight-16?null:recordingNotePlacement({left:rect.left,top:rect.top,width:rect.width,height:rect.height},area,card.scrollHeight);
   setPosition(old=>JSON.stringify(old)===JSON.stringify(next)?old:next);
  };
  place();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);observer?.observe(picture);observer?.observe(card);
  window.addEventListener('resize',place);window.addEventListener('scroll',place,true);picture.addEventListener('loadedmetadata',place);picture.addEventListener('load',place);
  return()=>{observer?.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);picture.removeEventListener('loadedmetadata',place);picture.removeEventListener('load',place);};
 },[media,note,enabled,mark?.x,mark?.y,mark?.width,mark?.height,key]);
 return position;
}
