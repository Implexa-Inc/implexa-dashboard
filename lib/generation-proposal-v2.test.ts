// node --test lib/generation-proposal-v2.test.ts
//
// The strict v2 document parser, driven against REAL compiled proposals and then
// against one-field tampers of the same documents. Each tamper below is a thing a
// bug, a forged response or a partial deploy could actually produce, and each one
// would misstate what the user is authorizing if it rendered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompiledProfessionalV2Proposal } from './generation-proposal-v2.ts';
import {
  V1_PREVIEW_FAST, V1_PREVIEW_PROFESSIONAL_AVAILABLE,
  V2_PREVIEW_AVAILABLE, V2_PREVIEW_JUDGE_OFF, V2_PREVIEW_MULTI, V2_PREVIEW_UNAVAILABLE,
} from './professional-v2.fixtures.ts';

type Doc = Record<string, unknown>;
const clone = <T>(v: T): Doc => structuredClone(v) as unknown as Doc;
const docOf = (fixture: { proposal: unknown }): Doc => clone(fixture.proposal);
/** Tamper with one field of a real document and expect a refusal. */
const tampered = (fixture: { proposal: unknown }, mutate: (doc: Doc) => void): Doc => {
  const doc = docOf(fixture);
  mutate(doc);
  return doc;
};
const graphOf = (doc: Doc) => doc.professional_control as Doc;
const momentsOf = (doc: Doc) => graphOf(doc).moments as Doc[];
const tasksOf = (doc: Doc) => graphOf(doc).authorization_tasks as Doc[];

test('every real v2 proposal parses, and reports coverage and takes separately', () => {
  const available = parseCompiledProfessionalV2Proposal(docOf(V2_PREVIEW_AVAILABLE));
  assert.ok(available);
  assert.equal(available.availability, true);
  assert.equal(available.unavailableReason, null);
  assert.equal(available.momentCount, 1);
  assert.equal(available.candidateTaskCount, 2);
  assert.equal(available.repairTaskCount, 1);
  assert.equal(available.taskCount, 3);
  assert.equal(available.initialCredits + available.repairReserveCredits, available.maximumCredits);
  assert.equal(available.maximumCredits, 108);
  assert.equal(available.projectionOnly, true);
  assert.equal(available.finalRenderAuthorized, false);

  const multi = parseCompiledProfessionalV2Proposal(docOf(V2_PREVIEW_MULTI));
  assert.ok(multi);
  assert.equal(multi.momentCount, 4);
  // COVERAGE is moments, never takes. Ten takes over four moments is four
  // moments of finished timeline.
  assert.ok(multi.candidateTaskCount > multi.momentCount);
  assert.equal(multi.moments.map((m) => m.momentId).join(','), 'hook,build,abut,close');
  // The abutting pair stays valid: one moment ends exactly where the next begins.
  assert.equal(multi.moments[1].endMs, multi.moments[2].startMs);
});

test('an unavailable proposal still carries its plan, and names what is missing', () => {
  const parsed = parseCompiledProfessionalV2Proposal(docOf(V2_PREVIEW_UNAVAILABLE));
  assert.ok(parsed);
  assert.equal(parsed.availability, false);
  assert.equal(parsed.unavailableReason, 'missing_required_professional_execution_capabilities');
  assert.ok(parsed.requiredMissingCapabilities.length > 0);
  // The plan is still visible — that is how a user sees what the capabilities block.
  assert.equal(parsed.taskCount, 3);
});

test('judge-off compiles no reserve and a variants_ready terminal', () => {
  const parsed = parseCompiledProfessionalV2Proposal(docOf(V2_PREVIEW_JUDGE_OFF));
  assert.ok(parsed);
  assert.equal(parsed.moments[0].judgeMode, 'off');
  assert.equal(parsed.moments[0].maxRepairs, 0);
  assert.equal(parsed.moments[0].terminalState, 'variants_ready');
  assert.equal(parsed.repairReserveCredits, 0);
  assert.equal(parsed.initialCredits, parsed.maximumCredits);
});

test('v1 documents are refused by the v2 parser', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(docOf(V1_PREVIEW_FAST)), null);
  assert.equal(parseCompiledProfessionalV2Proposal(docOf(V1_PREVIEW_PROFESSIONAL_AVAILABLE)), null);
});

test('a client-calculated credit figure is refused, in either direction', () => {
  for (const field of ['maximum_credits', 'initial_credits', 'repair_reserve_credits']) {
    for (const delta of [1, -1]) {
      assert.equal(
        parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
          d[field] = (d[field] as number) + delta;
        })), null, `${field} ${delta > 0 ? '+' : '-'}1`,
      );
    }
  }
  // The graph's own cost block must equal the sum of its tasks.
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    (graphOf(d).cost as Doc).maximum_credits = 1;
  })), null);
  // A task priced away from its moment's rate is a task that runs different
  // paid work than the one that was approved.
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    tasksOf(d)[0].credits = 1;
  })), null);
});

test('overlapping or out-of-order compiled moments are refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_MULTI, (d) => {
    // Pull moment 3 back so it starts inside moment 2.
    (momentsOf(d)[2].timestamp as Doc).start_ms = 10_000;
    momentsOf(d)[2].duration_seconds = 6;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_MULTI, (d) => {
    const moments = momentsOf(d);
    [moments[0], moments[1]] = [moments[1], moments[0]];
    (graphOf(d) as Doc).moments = moments;
  })), null);
});

test('a stated duration that disagrees with the window is refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    momentsOf(d)[0].duration_seconds = 10;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    (momentsOf(d)[0].timestamp as Doc).end_ms = 9000;
  })), null);
});

test('a repair reserve under judge-off is refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    momentsOf(d)[0].judge_mode = 'off';
  })), null);
  // Even with the terminal state adjusted to match, the reserve still cannot stand.
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    momentsOf(d)[0].judge_mode = 'off';
    momentsOf(d)[0].terminal_state = 'variants_ready';
  })), null);
});

test('a terminal state that disagrees with the Judge mode is refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_JUDGE_OFF, (d) => {
    momentsOf(d)[0].terminal_state = 'segment_ready';
  })), null);
});

test('a repair task marked active by default is refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    const repair = tasksOf(d).find((t) => t.task_kind === 'repair')!;
    repair.active_by_default = true;
  })), null);
});

test('task counts must equal the variant and repair policy they claim to serve', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    momentsOf(d)[0].variants_requested = 3;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    (momentsOf(d)[0].candidate_task_ids as string[]).pop();
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    d.task_count = (d.task_count as number) + 1;
  })), null);
});

test('an orphan task — one no moment claims — is refused', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    const tasks = tasksOf(d);
    tasks.push({ ...clone(tasks[0]), task_id: 'orphan-v9', candidate_ordinal: 9 });
  })), null);
});

test('a task whose provider, ratio or duration disagrees with its moment is refused', () => {
  for (const mutate of [
    (d: Doc) => { tasksOf(d)[0].model = 'gen-other'; },
    (d: Doc) => { tasksOf(d)[0].ratio = '1280:720'; },
    (d: Doc) => { tasksOf(d)[0].duration_seconds = 9; },
    (d: Doc) => { tasksOf(d)[0].pricing_version = '2020-01-01'; },
  ]) {
    assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, mutate)), null);
  }
});

test('availability and its reason must not contradict each other', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_UNAVAILABLE, (d) => {
    d.availability = true;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    d.availability = false;
  })), null);
  // Unavailable while naming nothing tells a user their plan is blocked and
  // refuses to say by what.
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_UNAVAILABLE, (d) => {
    d.required_missing_capabilities = [];
  })), null);
});

test('the assembly claim cannot be widened', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    (graphOf(d).assembly as Doc).final_render_authorized = true;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    (graphOf(d).assembly as Doc).projection_only = false;
  })), null);
});

test('required identity fields cannot be dropped, widened or swapped', () => {
  for (const mutate of [
    (d: Doc) => { d.quality_mode = 'fast'; },
    (d: Doc) => { d.capability_key = 'video.something_else'; },
    (d: Doc) => { d.compiler_version = 'generation-quality.v2'; },
    (d: Doc) => { d.contract_version = '2020-01-01'; },
    (d: Doc) => { delete d.proposal_digest; },
    (d: Doc) => { d.proposal_digest = 'not-a-digest'; },
    (d: Doc) => { delete d.professional_control; },
    (d: Doc) => { graphOf(d).contract_version = 'professional-generation-control.v1'; },
    (d: Doc) => { graphOf(d).desktop_capability_version = 'professional-execution-capability.v2'; },
    (d: Doc) => { delete graphOf(d).graph_digest; },
    (d: Doc) => { d.execution_mode = 'production'; },
    (d: Doc) => { momentsOf(d)[0].prompt = '   '; },
    (d: Doc) => { momentsOf(d)[0].ordinal = 5; },
    (d: Doc) => { (graphOf(d) as Doc).moments = []; },
  ]) {
    assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, mutate)), null);
  }
});

test('an unknown additive field is tolerated — an unknown STATE is not', () => {
  const additive = tampered(V2_PREVIEW_AVAILABLE, (d) => { d.some_future_hint = { note: 'ok' }; });
  assert.ok(parseCompiledProfessionalV2Proposal(additive));
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    momentsOf(d)[0].judge_mode = 'graded';
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    tasksOf(d)[0].task_kind = 'preview';
  })), null);
});

test('provider identity must be complete, and its auth binding must name its own provider', () => {
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    delete (momentsOf(d)[0].provider_identity as Doc).implementation_id;
  })), null);
  assert.equal(parseCompiledProfessionalV2Proposal(tampered(V2_PREVIEW_AVAILABLE, (d) => {
    ((momentsOf(d)[0].provider_identity as Doc).auth_identity as Doc).provider = 'someone-else';
  })), null);
  const parsed = parseCompiledProfessionalV2Proposal(docOf(V2_PREVIEW_AVAILABLE));
  assert.ok(parsed);
  // The identity the UI reads carries a binding, never a credential.
  assert.equal(parsed.moments[0].providerIdentity.authKind, 'local_key_vault');
  assert.equal(Object.keys(parsed.moments[0].providerIdentity).some((k) => /key|token|secret/i.test(k)), false);
});
