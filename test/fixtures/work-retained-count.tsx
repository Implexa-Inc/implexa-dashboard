import type {ComponentProps} from 'react';
import Sidebar,{ShellNavigationProvider,WorkAttentionSync} from '../../app/(dashboard)/_components/sidebar';
import {WorkList} from '../../app/(dashboard)/work/_components/work-feed';
export default function RetainedWorkFixture({seed,...props}:ComponentProps<typeof WorkList>&{seed?:{count:number;complete:boolean}}){
 return <ShellNavigationProvider userId="retained-review"><Sidebar user={{displayName:'Review account',email:'preview@example.com',plan:'free',isFoundingCreator:false}}/>{seed&&<WorkAttentionSync badge={seed}/>}<WorkList {...props}/></ShellNavigationProvider>;
}
