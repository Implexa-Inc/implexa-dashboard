import test from 'node:test';import assert from 'node:assert/strict';
import {parseApprovedListings} from './approved-marketplace-listings.ts';
const id='12000000-0000-4000-8000-000000000001';
const listing={id,slug:'studio',versionId:id,revision:5,name:'Video studio',studioName:'Studio',category:'Video',input:'Raw video',output:'Edited video',servicePriceCents:5000,pricePeriod:'per_run',engines:['claude','codex'],sampleCount:1,samplePlayback:'not_hosted',billing:'not_enabled',funding:'not_activated',tools:[]};
test('approved projection validates real metadata separately from illustrative stats and unavailable reads',()=>{
 assert.equal(parseApprovedListings({ok:true,listings:[listing]}).status,'ready');
 for(const v of [{ok:false},{ok:true,listings:[{...listing,samplePlayback:'ready'}]},{ok:true,listings:[{...listing,slug:'https://evil.test'}]},{ok:true,listings:[{...listing,servicePriceCents:-1}]}])assert.equal(parseApprovedListings(v).status,'unavailable');
 assert.deepEqual(parseApprovedListings({ok:true,listings:[]}),{status:'ready',listings:[]});
});

test('actual publication-to-review producer is accepted without fictional metrics or private training',async()=>{
 const {readFileSync}=await import('node:fs');const f=JSON.parse(readFileSync(new URL('./__fixtures__/marketplace-approved-producer.v1.json',import.meta.url),'utf8'));
 const parsed=parseApprovedListings(f.catalog);assert.equal(parsed.status,'ready');assert.equal(parsed.listings.length,1);
 assert.equal(parsed.listings[0].billing,'not_enabled');assert.equal(parsed.listings[0].samplePlayback,'not_hosted');
 assert.equal('runCount' in parsed.listings[0],false);assert.equal('samples' in parsed.listings[0],false);
});
