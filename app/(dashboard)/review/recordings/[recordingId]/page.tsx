import RecordingPlayer from './recording-player';

export const dynamic = 'force-dynamic';

/**
 * /review/recordings/[recordingId] — play a recording from the local library and mark
 * draft moments on it (spec §3.3, §5). NET NEW.
 *
 * The id is opaque and is the only thing handed to Implexa Desktop; the video plays
 * from the `implexa-artifact://preview/<token>` URL the Desktop mints for it. Moments
 * stay drafts in the library: turning them into review issues or learnings is a later
 * slice (L2/L3), not this page.
 */
export default function RecordingPlayerPage({ params }: { params: { recordingId: string } }) {
  return <RecordingPlayer recordingId={params.recordingId} />;
}
