import MachineSetupPage from '../machine-setup-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machine setup — Implexa' };

/** THE selected machine, carried from the Setup-required card as a path segment
 *  (the app's deep-link router keeps segments and drops query strings). */
export default async function Page({ params }: { params: { slug: string; machineId: string } }) {
  return <MachineSetupPage slug={params.slug} machineId={params.machineId} />;
}
