import {redirect} from 'next/navigation';

/** Preserve old bookmarks; discovery has one home in Agents. */
export default function BrowsePage(){redirect('/workflows?tab=rent');}
