import AgentHomeFrame from '../../app/(dashboard)/_components/agent-home-frame';
import AgentsList,{type ListAgent} from '../../app/(dashboard)/_components/agents-list';
export default function AgentCollectionFixture({agents,rosterKnown=true}:{agents:ListAgent[];rosterKnown?:boolean}){
 return <AgentHomeFrame count="Server count"><AgentsList agents={agents} rosterKnown={rosterKnown}/></AgentHomeFrame>;
}
