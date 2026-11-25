import test from 'node:test';
import assert from 'node:assert/strict';
import {resultRowChoices} from './result-row-choices.ts';

test('row choices preserve identifying columns and escaped punctuation across domains',()=>{
 const markdown=['| Project | Team |', '|---|---|', '| **Atlas** | A |', '| Atlas | B |', '',
   '| Clip | Take |','|---|---|','| A\\|B | `02` |','','```','| Ignore | Example |','|---|---|','| X | Y |','```'].join('\n');
 assert.deepEqual(resultRowChoices(markdown),['Project — Atlas · Team — A','Project — Atlas · Team — B','Clip — A|B · Take — 02']);
 assert.deepEqual(resultRowChoices('There were no results to choose from.'),[]);
});
