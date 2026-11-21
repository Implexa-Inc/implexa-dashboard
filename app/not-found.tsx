import Link from 'next/link';
import {Logo} from '@/components/logo';

export default function NotFound(){
 return <main className="app-page flex items-center justify-center"><section className="card w-full max-w-md text-center">
  <Logo height={28}/><h1 className="mt-8 text-3xl">This page isn’t here</h1>
  <p className="mt-3 text-sm text-ink-300">The link may have changed. Your agents and work are still available.</p>
  <Link href="/workflows" className="btn-primary mt-6">Go to your agents</Link>
 </section></main>;
}
