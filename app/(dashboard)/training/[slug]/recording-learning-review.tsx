'use client';

import {useState, type ReactNode} from 'react';
import {TEACHING_FIELDS, type RecordingFrame, type RecordingSuggestion} from '@/lib/training-teaching-draft';
import {formatTrainingTime} from '@/lib/training-local-ingress';

type Fields=RecordingSuggestion['fields'];
const labels:Record<keyof Fields,string>={
  chosen:'What the example shows',
  why:'Judgment',
  process:'When it applies',
  desiredBehavior:'What your agent should do',
};

export default function RecordingLearningReview({fields,frame,origin,scope,disabled,onReview}:{
  fields:Fields;frame:RecordingFrame;origin:'narration'|'screenshots';scope:ReactNode;disabled:boolean;
  onReview:(fields:Fields)=>void;
}){
  const [lesson,setLesson]=useState(fields);
  const [editing,setEditing]=useState(false);
  return <section aria-label="Suggested learning from your recording" className="space-y-4 rounded-xl border border-ink-800 p-4">
    <h3 className="font-medium">Suggested learning</h3>
    <p className="text-xs text-ink-400">{origin==='narration'?'From your narration':'Inferred from screenshots'} · {formatTrainingTime(frame.timeMs)}</p>
    <div className="flex flex-wrap gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame.image} alt="Screenshot supporting the suggested learning" className="w-48 rounded-lg object-contain"/>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        {editing?TEACHING_FIELDS.map(key=><label key={key} className="block">{labels[key]}
          <textarea value={lesson[key]} maxLength={400} disabled={disabled}
            onChange={event=>setLesson(current=>({...current,[key]:event.target.value}))}
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2"/>
        </label>):<>
          <p>{lesson.desiredBehavior}</p>
          <p className="text-ink-400">{lesson.process}</p>
          <details className="text-ink-400"><summary>Why this was suggested</summary><p>{lesson.why}</p><p>{lesson.chosen}</p></details>
        </>}
      </div>
    </div>
    {scope}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="btn-primary" disabled={disabled||TEACHING_FIELDS.some(key=>!lesson[key].trim())}
        onClick={()=>onReview(lesson)}>Review &amp; accept</button>
      <button type="button" className="btn-secondary" disabled={disabled} onClick={()=>setEditing(value=>!value)}>{editing?'Done editing':'Edit learning'}</button>
    </div>
  </section>;
}
