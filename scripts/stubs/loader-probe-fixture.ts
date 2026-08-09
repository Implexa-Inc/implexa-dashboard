/**
 * A resolution probe for `scripts/dom-test-loader.mjs`, and nothing else.
 *
 * `lib/mutation-harness-contract.test.ts` imports this through `@/` from inside a
 * throwaway mutant tree. The value below says WHICH tree answered: 'SOURCE' means the
 * real repository supplied it (the file was never copied), and a test that writes its
 * own copy exporting 'MUTANT' proves the copy wins. Both directions matter — one is
 * how a harness renders a component it did not fully copy, the other is the guarantee
 * that a mutated file is never quietly replaced by its pristine original.
 */
export const ORIGIN = 'SOURCE';
