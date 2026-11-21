import type {ReactNode} from 'react';
import RetryButton from './retry-button';

/** Shared list states from states.html. Unreadable and genuinely empty stay distinct. */
export function CollectionEmpty({title,description,enso=false,children}:{title:string;description:ReactNode;enso?:boolean;children?:ReactNode}){
 return <div className="collection-empty">{enso&&<div className="collection-empty-enso" aria-hidden="true"/>}<h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function CollectionReadError({title,description}:{title:string;description:string}){
 return <div role="alert" className="collection-read-error"><svg aria-hidden="true"><use href="/brand/tukido-icons.svg#alert"/></svg><h3>{title}</h3><p>{description}</p><RetryButton appearance="button"/></div>;
}
