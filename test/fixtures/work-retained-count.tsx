import type {ComponentProps} from 'react';
import Sidebar,{ShellNavigationProvider} from '../../app/(dashboard)/_components/sidebar';
import {WorkList} from '../../app/(dashboard)/work/_components/work-feed';
export default function RetainedWorkFixture(props:ComponentProps<typeof WorkList>){
 return <ShellNavigationProvider userId="retained-review"><Sidebar user={{displayName:'Review account',email:'preview@example.com',plan:'free',isFoundingCreator:false}}/><WorkList {...props}/></ShellNavigationProvider>;
}
