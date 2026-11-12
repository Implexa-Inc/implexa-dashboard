'use client';

import {usePathname,useRouter} from 'next/navigation';
import {isCreateFabSuppressed} from '@/lib/navigation';

/** All creation entry points open the same saved conversation. */
export default function CreateFab({marketplacePilot=false}:{marketplacePilot?:boolean}={}){
 const pathname=usePathname()||'',router=useRouter();
 if(isCreateFabSuppressed(pathname)||(marketplacePilot&&pathname==='/workflows'))return null;
 return <button type="button" onClick={()=>router.push('/create?from=training')} className="fixed bottom-6 right-6 z-30 rounded-full bg-brand-500 px-5 py-3 text-sm font-medium text-black shadow-lg hover:bg-brand-400">＋ Create</button>;
}
