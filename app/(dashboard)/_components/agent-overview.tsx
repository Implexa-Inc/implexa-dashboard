import type {ReactNode} from 'react';
/** One Overview for every viewer; callers supply only their authorized, real sections. */
export default function AgentOverview({inputs,output,signals=[],steps,needs,trust,limitations,children}:{
 inputs?:Array<{key:string;label:string;required:boolean;description?:string|null}>;output?:string|null;signals?:string[];
 steps?:ReactNode;needs?:ReactNode;trust?:ReactNode;limitations?:string|null;children?:ReactNode;
}){
 return <div className="agent-overview-content">
  {(inputs?.length||output)&&<section aria-label="What you give and get"><h2 className="agent-section-title">What you give, what you get</h2><div className="agent-give-get">
   <div className="card"><h3>You give</h3>{inputs?.length?<ul>{inputs.map(field=><li key={field.key}><p>{field.label}<small>{field.required?'Required':'Optional'}</small></p>{field.description&&<details><summary>About this input</summary><p>{field.description}</p></details>}</li>)}</ul>:<p>No run inputs declared.</p>}</div>
   <div className="card"><h3>You get</h3><p>{output}</p>{signals.length>0&&<ul>{signals.map(signal=><li key={signal}>{signal}</li>)}</ul>}</div>
  </div></section>}
  {steps&&<section aria-label="How it works">{steps}</section>}
  {needs&&<section className="agent-needs-section"><h2 className="agent-section-title">What it needs</h2>{needs}</section>}
  {limitations&&<section className="card"><h2>Keep in mind</h2><p>{limitations}</p></section>}
  {trust&&<section><h2 className="agent-section-title">Why you can trust it</h2>{trust}</section>}
  {children}
 </div>;
}
