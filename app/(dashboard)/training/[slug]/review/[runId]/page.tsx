import ReviewRoomPage from '../../../../_components/review-room-page';
export const dynamic='force-dynamic';
export default function Page(props:{params:{slug:string;runId:string};searchParams?:{artifact?:string}}){return ReviewRoomPage({...props,trainingSlug:props.params.slug});}
