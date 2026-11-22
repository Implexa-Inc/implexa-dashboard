import TrainingRouteHost,{TrainingRouteConfig} from '../../../app/(dashboard)/training/[slug]/training-route-host';
import type TrainingSource from '../../../app/(dashboard)/training/[slug]/training-source';
import type {ComponentProps} from 'react';
export default function Fixture({value,registered=true}:{value:ComponentProps<typeof TrainingSource>;registered?:boolean}){
 return <TrainingRouteHost>{registered?<TrainingRouteConfig value={value}/>:<p>Server route refused this context.</p>}</TrainingRouteHost>;
}
