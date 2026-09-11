import MachineSetupPage from './machine-setup-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machine setup — Implexa' };

/** No machine segment: the in-app bridge (or the backend's default) names the computer. */
export default async function Page({ params }: { params: { slug: string } }) {
  return <MachineSetupPage slug={params.slug} />;
}
