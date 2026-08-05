/**
 * GENERATED — do not edit by hand.
 *
 * Every document below is the REAL wire output of the Implexa backend producer
 * at commit a3422cc73189a0c6ac40cd869f39547a57e0b56f: previews, creates and reads
 * driven through generation-proposal.service.js itself, and availability
 * verdicts from evaluateProfessionalAvailability. Bounds are PROBED from the
 * producer, never transcribed.
 *
 * Regenerate with:
 *   IMPLEXA_BACKEND_DIR=/path/to/implexa-backend \
 *     node scripts/regenerate-professional-v2-fixtures.mjs
 * The generator refuses any other backend HEAD, and refuses to emit a document
 * containing a local path, a URL, a bearer token or a JWT.
 */

export const BACKEND_PIN = "a3422cc73189a0c6ac40cd869f39547a57e0b56f" as const;

export const CONTROL_CONTRACT_V1 = "professional-generation-control.v1" as const;

export const CONTROL_CONTRACT_V2 = "professional-generation-control.v2" as const;

export const DESKTOP_CAPABILITY_VERSION = "professional-execution-capability.v1" as const;

export const COMPILER_VERSION = "generation-quality.v1" as const;

export const CONTRACT_VERSION = "2026-08-01" as const;

export const CAPABILITY_KEY = "video.generate_broll" as const;

export const PROVIDER_PIN = {
  "provider": "runway",
  "model": "gen4.5",
  "implementation_id": "implexa.runway.text-to-video.v1",
  "adapter_version": "1",
  "provider_version": "2024-11-06",
  "pricing_version": "2026-08-01"
} as const;

export const PROVIDER_CATALOG = [
  {
    "provider": "runway",
    "model": "gen4.5",
    "pricing_version": "2026-08-01",
    "credits_per_second": 12,
    "supported_ratios": [
      "720:1280",
      "1280:720"
    ],
    "min_duration_seconds": 2,
    "max_duration_seconds": 10,
    "max_prompt_chars": 1000,
    "strengths": [
      "cinematic motion",
      "camera control",
      "coherent subject motion"
    ]
  }
] as const;

export const REQUEST_SUPPORTED_RATIOS = [
  "720:1280"
] as const;

export const PROBED_BOUNDS = {
  "maxMoments": 10,
  "minVariantsPerMoment": 1,
  "maxVariantsPerMoment": 4,
  "maxRepairsPerMoment": 1,
  "maxTotalTasks": 40,
  "minDurationSeconds": 2,
  "maxDurationSeconds": 10,
  "promptMaxChars": 700,
  "judgeModes": [
    "off",
    "ranked"
  ],
  "judgeModesAllowingRepair": [
    "ranked"
  ]
} as const;

export const MAX_SOURCE_PROMPT_CHARS = {
  "1": {
    "0": 1000,
    "1": 857
  },
  "2": {
    "0": 821,
    "1": 821
  },
  "3": {
    "0": 821,
    "1": 821
  },
  "4": {
    "0": 821,
    "1": 821
  }
} as const;

export const DERIVED_PROMPT_SUFFIXES = {
  "candidate": {
    "1": {
      "1": ""
    },
    "2": {
      "1": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "2": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants."
    },
    "3": {
      "1": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "2": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
      "3": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants."
    },
    "4": {
      "1": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "2": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
      "3": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
      "4": ". Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 3: a distinct camera angle from the other variants."
    }
  },
  "repair": ". Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects."
} as const;

export const MOMENT_ID_VERDICTS = [
  {
    "id": "hook",
    "accepted": true
  },
  {
    "id": "h",
    "accepted": true
  },
  {
    "id": "0",
    "accepted": true
  },
  {
    "id": "a-b_c",
    "accepted": true
  },
  {
    "id": "moment-1",
    "accepted": true
  },
  {
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "accepted": true
  },
  {
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "accepted": false
  },
  {
    "id": "Hook",
    "accepted": false
  },
  {
    "id": "-hook",
    "accepted": false
  },
  {
    "id": "_hook",
    "accepted": false
  },
  {
    "id": "hook!",
    "accepted": false
  },
  {
    "id": "hook.1",
    "accepted": false
  },
  {
    "id": "hook 1",
    "accepted": false
  },
  {
    "id": "",
    "accepted": false
  },
  {
    "id": "ünïcode",
    "accepted": false
  }
] as const;

export const TIMELINE_VERDICTS = [
  {
    "label": "ascending_gap",
    "accepted": true
  },
  {
    "label": "abutting",
    "accepted": true
  },
  {
    "label": "overlapping",
    "accepted": false
  },
  {
    "label": "out_of_order",
    "accepted": false
  },
  {
    "label": "duplicate_ids",
    "accepted": false
  },
  {
    "label": "repair_with_judge_off",
    "accepted": false
  },
  {
    "label": "repair_with_judge_ranked",
    "accepted": true
  },
  {
    "label": "blank_prompt",
    "accepted": false
  },
  {
    "label": "sub_second_precision",
    "accepted": true
  },
  {
    "label": "finer_than_millisecond",
    "accepted": false
  },
  {
    "label": "task_ceiling_exceeded",
    "accepted": false
  },
  {
    "label": "task_ceiling_at_limit",
    "accepted": true
  }
] as const;

export const AVAILABILITY_FLAGS_FALSE = {
  "available": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.professional_execution.v1",
    "server.control_plane_v1",
    "server.judge_evidence_v2",
    "server.segment_projection_v1"
  ],
  "contract_version": "professional-execution-capability.v1",
  "availability_contract_version": "professional-availability.v2"
} as const;

export const AVAILABILITY_V2_READY = {
  "available": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "contract_version": "professional-execution-capability.v1",
  "availability_contract_version": "professional-availability.v2"
} as const;

export const AVAILABILITY_V1_ONLY_MACHINE_ON_V2 = {
  "available": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.multi_moment_control_v2"
  ],
  "contract_version": "professional-execution-capability.v1",
  "availability_contract_version": "professional-availability.v2"
} as const;

export const V2_PREVIEW_UNAVAILABLE = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.professional_execution.v1",
    "server.control_plane_v1",
    "server.judge_evidence_v2",
    "server.segment_projection_v1"
  ],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_professional_execution_capabilities",
    "required_missing_capabilities": [
      "desktop.professional_execution.v1",
      "server.control_plane_v1",
      "server.judge_evidence_v2",
      "server.segment_projection_v1"
    ],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "440d22689077576aa0aaf5fef2a3ac29966c1663025b136e2ac95902ffba445e"
    },
    "task_count": 3,
    "maximum_credits": 108,
    "initial_credits": 72,
    "repair_reserve_credits": 36,
    "proposal_digest": "e96fc460bcdc87dbb235b6e124a42394769926912eb1c43f103b131047271e1e"
  }
} as const;

export const V2_PREVIEW_AVAILABLE = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "440d22689077576aa0aaf5fef2a3ac29966c1663025b136e2ac95902ffba445e"
    },
    "task_count": 3,
    "maximum_credits": 108,
    "initial_credits": 72,
    "repair_reserve_credits": 36,
    "proposal_digest": "223e59faaad74af7bf27d953a4215dd218d1d4995d8f21b338424298d6184d6d"
  }
} as const;

export const V2_PREVIEW_JUDGE_OFF = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 1,
          "judge_mode": "off",
          "repair_policy": {
            "max_repairs": 0
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1"
          ],
          "repair_task_ids": [],
          "terminal_state": "variants_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "variants_ready-hook",
          "depends_on": [
            "hook-v1"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 36,
        "repair_reserve_credits": 0,
        "maximum_credits": 36
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "8a2ded2ee801964c99cbdda80005056ce38b3bbca72c8bb54d23cf035af38c11"
    },
    "task_count": 1,
    "maximum_credits": 36,
    "initial_credits": 36,
    "repair_reserve_credits": 0,
    "proposal_digest": "73ea5356604d7c32f023b0e5d2d96dd5324be410bce9d050577dac65551fad26"
  }
} as const;

export const V2_PREVIEW_MULTI = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        },
        {
          "moment_id": "build",
          "start_ms": 8000,
          "end_ms": 12000
        },
        {
          "moment_id": "abut",
          "start_ms": 12000,
          "end_ms": 16000
        },
        {
          "moment_id": "close",
          "start_ms": 24000,
          "end_ms": 34000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          },
          {
            "moment_id": "build",
            "start_ms": 8000,
            "end_ms": 12000
          },
          {
            "moment_id": "abut",
            "start_ms": 12000,
            "end_ms": 16000
          },
          {
            "moment_id": "close",
            "start_ms": 24000,
            "end_ms": 34000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "build",
          "ordinal": 1,
          "timestamp": {
            "start_ms": 8000,
            "end_ms": 12000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "variants_requested": 1,
          "judge_mode": "off",
          "repair_policy": {
            "max_repairs": 0
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "build-v1"
          ],
          "repair_task_ids": [],
          "terminal_state": "variants_ready"
        },
        {
          "moment_id": "abut",
          "ordinal": 2,
          "timestamp": {
            "start_ms": 12000,
            "end_ms": 16000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "hand lifting a phone into frame, soft window light",
          "prompt_digest": "b0eca1b7e59c8f2e4c8c9c769ddb5d7d290f95d3a0ced3c873e687e4ee123bfd",
          "variants_requested": 3,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ],
          "repair_task_ids": [
            "abut-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "close",
          "ordinal": 3,
          "timestamp": {
            "start_ms": 24000,
            "end_ms": 34000
          },
          "duration_seconds": 10,
          "ratio": "720:1280",
          "prompt": "wide skyline at dusk, slow drift right",
          "prompt_digest": "a236beb1b62b54535045593685fff6ebd123d2e41f2e7d372906f7e3a215cc48",
          "variants_requested": 4,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 120,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ],
          "repair_task_ids": [
            "close-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        },
        {
          "task_id": "build-v1",
          "moment_id": "build",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v1",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "eb267a66c02f5b88e9684dd6a54bbc7448167a471ff288927a0b3f3972720fd1",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v2",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "93f7b836323745258c92672ad196b383c66d70729e2b8e67251c6f2b5e753576",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v3",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "1299806d4a3e36e663007f793facc00c01f037b09079e856448677d86be33922",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-repair-1",
          "moment_id": "abut",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "b5d6253ce1855dd57ede4c38d8024c918a8ffc0d0929788eabe86df1be91b5d9",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": false
        },
        {
          "task_id": "close-v1",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "7d6e702320110a2711b82d240ecd98f08b1777a144c8d2233123a9af0488b854",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v2",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "4131a71f043f1e416bc7f50300a8defb14605ba95d7b8c6e655f883cc75c7744",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v3",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "974edc1d72008a7a05c1013f4523c127f7a612a768d2f772ab0a675c55fff3eb",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v4",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 4,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 3: a distinct camera angle from the other variants.",
          "prompt_digest": "c7f4f9110d751d55805b68a6dc927e504cc928cbe0e5284364bab48038e588a2",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-repair-1",
          "moment_id": "close",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "3462ffe58f801db9c7c0e56a0d57cf56e803b791d3f5a1ca896626dc96eb7a0c",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        },
        {
          "node_id": "build-v1",
          "depends_on": []
        },
        {
          "node_id": "variants_ready-build",
          "depends_on": [
            "build-v1"
          ]
        },
        {
          "node_id": "abut-v1",
          "depends_on": []
        },
        {
          "node_id": "abut-v2",
          "depends_on": []
        },
        {
          "node_id": "abut-v3",
          "depends_on": []
        },
        {
          "node_id": "abut-repair-1",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ]
        },
        {
          "node_id": "select-abut",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3",
            "abut-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-abut",
          "depends_on": [
            "select-abut"
          ]
        },
        {
          "node_id": "close-v1",
          "depends_on": []
        },
        {
          "node_id": "close-v2",
          "depends_on": []
        },
        {
          "node_id": "close-v3",
          "depends_on": []
        },
        {
          "node_id": "close-v4",
          "depends_on": []
        },
        {
          "node_id": "close-repair-1",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ]
        },
        {
          "node_id": "select-close",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4",
            "close-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-close",
          "depends_on": [
            "select-close"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 744,
        "repair_reserve_credits": 204,
        "maximum_credits": 948
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "591bcde49b17ad65ef4885da783aa36a1a7883c0e45edb3cc0a91da496fd7347"
    },
    "task_count": 13,
    "maximum_credits": 948,
    "initial_credits": 744,
    "repair_reserve_credits": 204,
    "proposal_digest": "658ec9c11137616a0b051a7ac2fa5837b2e4f203832457986bdc72430ded14e7"
  }
} as const;

export const V2_PREVIEW_MULTI_UNAVAILABLE = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.professional_execution.v1",
    "server.control_plane_v1",
    "server.judge_evidence_v2",
    "server.segment_projection_v1"
  ],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        },
        {
          "moment_id": "build",
          "start_ms": 8000,
          "end_ms": 12000
        },
        {
          "moment_id": "abut",
          "start_ms": 12000,
          "end_ms": 16000
        },
        {
          "moment_id": "close",
          "start_ms": 24000,
          "end_ms": 34000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_professional_execution_capabilities",
    "required_missing_capabilities": [
      "desktop.professional_execution.v1",
      "server.control_plane_v1",
      "server.judge_evidence_v2",
      "server.segment_projection_v1"
    ],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          },
          {
            "moment_id": "build",
            "start_ms": 8000,
            "end_ms": 12000
          },
          {
            "moment_id": "abut",
            "start_ms": 12000,
            "end_ms": 16000
          },
          {
            "moment_id": "close",
            "start_ms": 24000,
            "end_ms": 34000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "build",
          "ordinal": 1,
          "timestamp": {
            "start_ms": 8000,
            "end_ms": 12000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "variants_requested": 1,
          "judge_mode": "off",
          "repair_policy": {
            "max_repairs": 0
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "build-v1"
          ],
          "repair_task_ids": [],
          "terminal_state": "variants_ready"
        },
        {
          "moment_id": "abut",
          "ordinal": 2,
          "timestamp": {
            "start_ms": 12000,
            "end_ms": 16000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "hand lifting a phone into frame, soft window light",
          "prompt_digest": "b0eca1b7e59c8f2e4c8c9c769ddb5d7d290f95d3a0ced3c873e687e4ee123bfd",
          "variants_requested": 3,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ],
          "repair_task_ids": [
            "abut-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "close",
          "ordinal": 3,
          "timestamp": {
            "start_ms": 24000,
            "end_ms": 34000
          },
          "duration_seconds": 10,
          "ratio": "720:1280",
          "prompt": "wide skyline at dusk, slow drift right",
          "prompt_digest": "a236beb1b62b54535045593685fff6ebd123d2e41f2e7d372906f7e3a215cc48",
          "variants_requested": 4,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 120,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ],
          "repair_task_ids": [
            "close-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        },
        {
          "task_id": "build-v1",
          "moment_id": "build",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v1",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "eb267a66c02f5b88e9684dd6a54bbc7448167a471ff288927a0b3f3972720fd1",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v2",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "93f7b836323745258c92672ad196b383c66d70729e2b8e67251c6f2b5e753576",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v3",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "1299806d4a3e36e663007f793facc00c01f037b09079e856448677d86be33922",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-repair-1",
          "moment_id": "abut",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "b5d6253ce1855dd57ede4c38d8024c918a8ffc0d0929788eabe86df1be91b5d9",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": false
        },
        {
          "task_id": "close-v1",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "7d6e702320110a2711b82d240ecd98f08b1777a144c8d2233123a9af0488b854",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v2",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "4131a71f043f1e416bc7f50300a8defb14605ba95d7b8c6e655f883cc75c7744",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v3",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "974edc1d72008a7a05c1013f4523c127f7a612a768d2f772ab0a675c55fff3eb",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v4",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 4,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 3: a distinct camera angle from the other variants.",
          "prompt_digest": "c7f4f9110d751d55805b68a6dc927e504cc928cbe0e5284364bab48038e588a2",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-repair-1",
          "moment_id": "close",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "3462ffe58f801db9c7c0e56a0d57cf56e803b791d3f5a1ca896626dc96eb7a0c",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        },
        {
          "node_id": "build-v1",
          "depends_on": []
        },
        {
          "node_id": "variants_ready-build",
          "depends_on": [
            "build-v1"
          ]
        },
        {
          "node_id": "abut-v1",
          "depends_on": []
        },
        {
          "node_id": "abut-v2",
          "depends_on": []
        },
        {
          "node_id": "abut-v3",
          "depends_on": []
        },
        {
          "node_id": "abut-repair-1",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ]
        },
        {
          "node_id": "select-abut",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3",
            "abut-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-abut",
          "depends_on": [
            "select-abut"
          ]
        },
        {
          "node_id": "close-v1",
          "depends_on": []
        },
        {
          "node_id": "close-v2",
          "depends_on": []
        },
        {
          "node_id": "close-v3",
          "depends_on": []
        },
        {
          "node_id": "close-v4",
          "depends_on": []
        },
        {
          "node_id": "close-repair-1",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ]
        },
        {
          "node_id": "select-close",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4",
            "close-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-close",
          "depends_on": [
            "select-close"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 744,
        "repair_reserve_credits": 204,
        "maximum_credits": 948
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "591bcde49b17ad65ef4885da783aa36a1a7883c0e45edb3cc0a91da496fd7347"
    },
    "task_count": 13,
    "maximum_credits": 948,
    "initial_credits": 744,
    "repair_reserve_credits": 204,
    "proposal_digest": "17faedb3ee5673f88bcf32f8c669df5ab95ed3f7ad9067c6265e0cc1099f94d5"
  }
} as const;

export const V2_CREATE_UNAVAILABLE = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "state": "unavailable",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.professional_execution.v1",
    "server.control_plane_v1",
    "server.judge_evidence_v2",
    "server.segment_projection_v1"
  ],
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "e96fc460bcdc87dbb235b6e124a42394769926912eb1c43f103b131047271e1e",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "created_at": "2026-08-04T17:00:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_professional_execution_capabilities",
    "required_missing_capabilities": [
      "desktop.professional_execution.v1",
      "server.control_plane_v1",
      "server.judge_evidence_v2",
      "server.segment_projection_v1"
    ],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "440d22689077576aa0aaf5fef2a3ac29966c1663025b136e2ac95902ffba445e"
    },
    "task_count": 3,
    "maximum_credits": 108,
    "initial_credits": 72,
    "repair_reserve_credits": 36,
    "proposal_digest": "e96fc460bcdc87dbb235b6e124a42394769926912eb1c43f103b131047271e1e"
  }
} as const;

export const V2_CREATE_AVAILABLE = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "state": "awaiting_approval",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "223e59faaad74af7bf27d953a4215dd218d1d4995d8f21b338424298d6184d6d",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "created_at": "2026-08-04T17:00:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "440d22689077576aa0aaf5fef2a3ac29966c1663025b136e2ac95902ffba445e"
    },
    "task_count": 3,
    "maximum_credits": 108,
    "initial_credits": 72,
    "repair_reserve_credits": 36,
    "proposal_digest": "223e59faaad74af7bf27d953a4215dd218d1d4995d8f21b338424298d6184d6d"
  }
} as const;

export const V2_GET_UNAVAILABLE = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "lifecycle_state": "unavailable",
  "progress_state": "unavailable",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "e96fc460bcdc87dbb235b6e124a42394769926912eb1c43f103b131047271e1e",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_professional_execution_capabilities",
    "required_missing_capabilities": [
      "desktop.professional_execution.v1",
      "server.control_plane_v1",
      "server.judge_evidence_v2",
      "server.segment_projection_v1"
    ],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "440d22689077576aa0aaf5fef2a3ac29966c1663025b136e2ac95902ffba445e"
    },
    "task_count": 3,
    "maximum_credits": 108,
    "initial_credits": 72,
    "repair_reserve_credits": 36,
    "proposal_digest": "e96fc460bcdc87dbb235b6e124a42394769926912eb1c43f103b131047271e1e"
  },
  "cost": {
    "total_credits": 0,
    "maximum_credits": 108
  },
  "authorization": null,
  "task_progress": [],
  "receipt": null,
  "review_artifacts": []
} as const;

export const V2_GET_AWAITING_APPROVAL = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "lifecycle_state": "awaiting_approval",
  "progress_state": "awaiting_approval",
  "availability": true,
  "unavailable_reason": null,
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "658ec9c11137616a0b051a7ac2fa5837b2e4f203832457986bdc72430ded14e7",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "control_contract_version": "professional-generation-control.v2",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        },
        {
          "moment_id": "build",
          "start_ms": 8000,
          "end_ms": 12000
        },
        {
          "moment_id": "abut",
          "start_ms": 12000,
          "end_ms": 16000
        },
        {
          "moment_id": "close",
          "start_ms": 24000,
          "end_ms": 34000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "execution_mode": "professional",
    "professional_control": {
      "contract_version": "professional-generation-control.v2",
      "desktop_capability_version": "professional-execution-capability.v1",
      "execution_mode": "professional",
      "source_binding": {
        "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
        "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
        "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "media_duration_ms": 600000,
        "windows": [
          {
            "moment_id": "hook",
            "start_ms": 0,
            "end_ms": 3000
          },
          {
            "moment_id": "build",
            "start_ms": 8000,
            "end_ms": 12000
          },
          {
            "moment_id": "abut",
            "start_ms": 12000,
            "end_ms": 16000
          },
          {
            "moment_id": "close",
            "start_ms": 24000,
            "end_ms": 34000
          }
        ]
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_ms": 0,
            "end_ms": 3000
          },
          "duration_seconds": 3,
          "ratio": "720:1280",
          "prompt": "a slow aerial push over a bay bridge at sunrise",
          "prompt_digest": "1e9d023360eeedfea66f79c2b8b5916ac2457c5f95c48cff879eb43ba8c6f090",
          "variants_requested": 2,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 36,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "hook-v1",
            "hook-v2"
          ],
          "repair_task_ids": [
            "hook-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "build",
          "ordinal": 1,
          "timestamp": {
            "start_ms": 8000,
            "end_ms": 12000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "variants_requested": 1,
          "judge_mode": "off",
          "repair_policy": {
            "max_repairs": 0
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "build-v1"
          ],
          "repair_task_ids": [],
          "terminal_state": "variants_ready"
        },
        {
          "moment_id": "abut",
          "ordinal": 2,
          "timestamp": {
            "start_ms": 12000,
            "end_ms": 16000
          },
          "duration_seconds": 4,
          "ratio": "720:1280",
          "prompt": "hand lifting a phone into frame, soft window light",
          "prompt_digest": "b0eca1b7e59c8f2e4c8c9c769ddb5d7d290f95d3a0ced3c873e687e4ee123bfd",
          "variants_requested": 3,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 48,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ],
          "repair_task_ids": [
            "abut-repair-1"
          ],
          "terminal_state": "segment_ready"
        },
        {
          "moment_id": "close",
          "ordinal": 3,
          "timestamp": {
            "start_ms": 24000,
            "end_ms": 34000
          },
          "duration_seconds": 10,
          "ratio": "720:1280",
          "prompt": "wide skyline at dusk, slow drift right",
          "prompt_digest": "a236beb1b62b54535045593685fff6ebd123d2e41f2e7d372906f7e3a215cc48",
          "variants_requested": 4,
          "judge_mode": "ranked",
          "repair_policy": {
            "max_repairs": 1
          },
          "provider_identity": {
            "provider": "runway",
            "model": "gen4.5",
            "implementation_id": "implexa.runway.text-to-video.v1",
            "adapter_version": "1",
            "provider_version": "2024-11-06",
            "pricing_version": "2026-08-01",
            "auth_identity": {
              "kind": "local_key_vault",
              "provider": "runway",
              "binding": "authenticated_claiming_machine"
            }
          },
          "credits_per_task": 120,
          "reference_artifact_ids": [],
          "candidate_task_ids": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ],
          "repair_task_ids": [
            "close-repair-1"
          ],
          "terminal_state": "segment_ready"
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-v1",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "83c6355f06bfe6fdd7fb755ce54c1759e17f29ced5d64a3aa301b3626470c3c3",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-v2",
          "moment_id": "hook",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "e8c19dd42384ad7906f5564e97169a13e95f0487286cdbadcd57f4749128d214",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "a slow aerial push over a bay bridge at sunrise. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "242c4489fe334c387e1785da0b8c38782a6fbc347764bedc4e6a80352c562d3a",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        },
        {
          "task_id": "build-v1",
          "moment_id": "build",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "terminal output scrolling, shallow depth of field",
          "prompt_digest": "911c7d76ac38eb3968925397b033c5ab36174b843872a78a424bc5afbe02d727",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v1",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "eb267a66c02f5b88e9684dd6a54bbc7448167a471ff288927a0b3f3972720fd1",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v2",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "93f7b836323745258c92672ad196b383c66d70729e2b8e67251c6f2b5e753576",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-v3",
          "moment_id": "abut",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "1299806d4a3e36e663007f793facc00c01f037b09079e856448677d86be33922",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": true
        },
        {
          "task_id": "abut-repair-1",
          "moment_id": "abut",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "hand lifting a phone into frame, soft window light. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "b5d6253ce1855dd57ede4c38d8024c918a8ffc0d0929788eabe86df1be91b5d9",
          "ratio": "720:1280",
          "duration_seconds": 4,
          "credits": 48,
          "active_by_default": false
        },
        {
          "task_id": "close-v1",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "7d6e702320110a2711b82d240ecd98f08b1777a144c8d2233123a9af0488b854",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v2",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 2,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 1: a distinct camera angle from the other variants.",
          "prompt_digest": "4131a71f043f1e416bc7f50300a8defb14605ba95d7b8c6e655f883cc75c7744",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v3",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 3,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 2: a distinct camera angle from the other variants.",
          "prompt_digest": "974edc1d72008a7a05c1013f4523c127f7a612a768d2f772ab0a675c55fff3eb",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-v4",
          "moment_id": "close",
          "task_kind": "candidate",
          "candidate_ordinal": 4,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage 3: a distinct camera angle from the other variants.",
          "prompt_digest": "c7f4f9110d751d55805b68a6dc927e504cc928cbe0e5284364bab48038e588a2",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": true
        },
        {
          "task_id": "close-repair-1",
          "moment_id": "close",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "provider": "runway",
          "model": "gen4.5",
          "provider_version": "2024-11-06",
          "pricing_version": "2026-08-01",
          "prompt_text": "wide skyline at dusk, slow drift right. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "3462ffe58f801db9c7c0e56a0d57cf56e803b791d3f5a1ca896626dc96eb7a0c",
          "ratio": "720:1280",
          "duration_seconds": 10,
          "credits": 120,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-v1",
          "depends_on": []
        },
        {
          "node_id": "hook-v2",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-v1",
            "hook-v2"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-v1",
            "hook-v2",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-hook",
          "depends_on": [
            "select-hook"
          ]
        },
        {
          "node_id": "build-v1",
          "depends_on": []
        },
        {
          "node_id": "variants_ready-build",
          "depends_on": [
            "build-v1"
          ]
        },
        {
          "node_id": "abut-v1",
          "depends_on": []
        },
        {
          "node_id": "abut-v2",
          "depends_on": []
        },
        {
          "node_id": "abut-v3",
          "depends_on": []
        },
        {
          "node_id": "abut-repair-1",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3"
          ]
        },
        {
          "node_id": "select-abut",
          "depends_on": [
            "abut-v1",
            "abut-v2",
            "abut-v3",
            "abut-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-abut",
          "depends_on": [
            "select-abut"
          ]
        },
        {
          "node_id": "close-v1",
          "depends_on": []
        },
        {
          "node_id": "close-v2",
          "depends_on": []
        },
        {
          "node_id": "close-v3",
          "depends_on": []
        },
        {
          "node_id": "close-v4",
          "depends_on": []
        },
        {
          "node_id": "close-repair-1",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4"
          ]
        },
        {
          "node_id": "select-close",
          "depends_on": [
            "close-v1",
            "close-v2",
            "close-v3",
            "close-v4",
            "close-repair-1"
          ]
        },
        {
          "node_id": "segment_ready-close",
          "depends_on": [
            "select-close"
          ]
        }
      ],
      "selection_policy": {
        "exactly_one_per_judged_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required_when_judged": true
      },
      "cost": {
        "initial_credits": 744,
        "repair_reserve_credits": 204,
        "maximum_credits": 948
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "591bcde49b17ad65ef4885da783aa36a1a7883c0e45edb3cc0a91da496fd7347"
    },
    "task_count": 13,
    "maximum_credits": 948,
    "initial_credits": 744,
    "repair_reserve_credits": 204,
    "proposal_digest": "658ec9c11137616a0b051a7ac2fa5837b2e4f203832457986bdc72430ded14e7"
  },
  "cost": {
    "total_credits": 0,
    "maximum_credits": 948
  },
  "authorization": null,
  "task_progress": [],
  "receipt": null,
  "review_artifacts": []
} as const;

export const READ_FIXTURE_CLOCK = "2026-08-04T17:00:00.000Z" as const;

export const V1_PREVIEW_FAST = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "fast",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "plan",
        "kind": "minimal_planning",
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "plan"
        ]
      },
      {
        "id": "validate",
        "kind": "deterministic_validation",
        "inputs": [
          "generate"
        ]
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "validate"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 1,
      "label": "low",
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge",
        "prompt_digest": "ee6743014f7773982d9555b9538743436a4dbe6d31da13184b2b41bc49a75c0a",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0
      }
    ],
    "task_count": 1,
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      }
    ],
    "maximum_credits": 36,
    "review_requirements": [
      "deterministic_validation",
      "user_review"
    ],
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8"
  }
} as const;

export const V1_PREVIEW_FAST_MULTI = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "fast",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 5000
        },
        {
          "moment_id": "build",
          "start_ms": 12000,
          "end_ms": 17000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "plan",
        "kind": "minimal_planning",
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "plan"
        ]
      },
      {
        "id": "validate",
        "kind": "deterministic_validation",
        "inputs": [
          "generate"
        ]
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "validate"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 1,
      "label": "low",
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 5
        },
        "model": "gen4.5",
        "prompt_text": "Founder opens laptop in dim room, screen glow on face",
        "prompt_digest": "61356a2276208213827d64f81a1f5b246567819442f9a5dd4510d1a480e84111",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0
      },
      {
        "task_id": "build-primary",
        "moment_id": "build",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up",
        "prompt_digest": "07fa76fc367131dd8ebcf4635ee204e19a3a6843c3ed7e8181c0c66b8aef1077",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0
      }
    ],
    "task_count": 2,
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 60
      },
      {
        "task_id": "build-primary",
        "credits": 60
      }
    ],
    "maximum_credits": 120,
    "review_requirements": [
      "deterministic_validation",
      "user_review"
    ],
    "proposal_digest": "a1a76270b551de0ca829d1239698fd06b33b3186fce4fa4b94566c0e512ab976"
  }
} as const;

export const V1_PREVIEW_PROFESSIONAL_AVAILABLE = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "analyze",
        "kind": "moment_analysis",
        "deterministic": true
      },
      {
        "id": "prompt",
        "kind": "prompt_development",
        "inputs": [
          "analyze"
        ],
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "prompt"
        ]
      },
      {
        "id": "judge",
        "kind": "per_asset_judge",
        "inputs": [
          "generate"
        ],
        "required": true
      },
      {
        "id": "repair",
        "kind": "clip_level_repair",
        "inputs": [
          "judge"
        ],
        "eligible": true,
        "paid_retries": 1
      },
      {
        "id": "assemble",
        "kind": "segmented_assembly",
        "inputs": [
          "repair"
        ],
        "required": true
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "assemble"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 2,
      "label": "high",
      "paid_retries": 1,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "280b845810e54a6b048bdc5622e4c240280f665a08ee65ecafcd142fa3b489d9",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "hook-coverage",
        "moment_id": "hook",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "4de1f38917b655398416eedb8a5db4a7bd34008272ddc3d47efe2cb276246e05",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "hook-repair-1",
        "moment_id": "hook",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "74ca6bc8b3d172b56c8256ddd3629063cef79bc7b8f289ebdaf1fe1318c4d503",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "active_by_default": false
      }
    ],
    "task_count": 3,
    "candidate_task_count": 2,
    "repair_task_count": 1,
    "professional_control": {
      "contract_version": "professional-generation-control.v1",
      "desktop_capability_version": "professional-execution-capability.v1",
      "provider_identity": {
        "provider": "runway",
        "model": "gen4.5",
        "implementation_id": "implexa.runway.text-to-video.v1",
        "adapter_version": "1",
        "provider_version": "2024-11-06",
        "pricing_version": "2026-08-01",
        "auth_identity": {
          "kind": "local_key_vault",
          "provider": "runway",
          "binding": "authenticated_claiming_machine"
        }
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "candidate_task_ids": [
            "hook-primary",
            "hook-coverage"
          ],
          "repair_task_id": "hook-repair-1",
          "depends_on_moment_ids": []
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-primary",
          "moment_id": "hook",
          "variant": "primary",
          "candidate_ordinal": 1,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "280b845810e54a6b048bdc5622e4c240280f665a08ee65ecafcd142fa3b489d9",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "paid_retries": 0,
          "paid_alternatives": 0,
          "task_kind": "candidate",
          "active_by_default": true
        },
        {
          "task_id": "hook-coverage",
          "moment_id": "hook",
          "variant": "coverage",
          "candidate_ordinal": 2,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
          "prompt_digest": "4de1f38917b655398416eedb8a5db4a7bd34008272ddc3d47efe2cb276246e05",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "paid_retries": 0,
          "paid_alternatives": 0,
          "task_kind": "candidate",
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "74ca6bc8b3d172b56c8256ddd3629063cef79bc7b8f289ebdaf1fe1318c4d503",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-primary",
          "depends_on": []
        },
        {
          "node_id": "hook-coverage",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-primary",
            "hook-coverage"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-primary",
            "hook-coverage",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment-ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "repair_policy": {
        "max_repairs_per_moment": 1,
        "requires_exactly_one_failed_candidate": true,
        "requires_typed_judge_failure": true,
        "new_approval_identity_forbidden": true
      },
      "selection_policy": {
        "exactly_one_per_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "1956d4cc09e927bdebb0ee6a8974b85417caaab52382e0bb2124081321c0e344"
    },
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      },
      {
        "task_id": "hook-coverage",
        "credits": 36
      },
      {
        "task_id": "hook-repair-1",
        "credits": 36
      }
    ],
    "maximum_credits": 108,
    "review_requirements": [
      "per_asset_judge",
      "clip_level_repair_eligible",
      "segmented_assembly",
      "user_review"
    ],
    "proposal_digest": "74573419eabaabe529e204e0f7cc822e3f6fc215ca6d9ec96d75dd0fee97ea3f"
  }
} as const;

export const V1_PREVIEW_PROFESSIONAL_UNAVAILABLE = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "desktop.professional_execution.v1",
    "server.control_plane_v1",
    "server.judge_evidence_v2",
    "server.segment_projection_v1"
  ],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "professional",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_professional_execution_capabilities",
    "required_missing_capabilities": [
      "desktop.professional_execution.v1",
      "server.control_plane_v1",
      "server.judge_evidence_v2",
      "server.segment_projection_v1"
    ],
    "stages": [
      {
        "id": "analyze",
        "kind": "moment_analysis",
        "deterministic": true
      },
      {
        "id": "prompt",
        "kind": "prompt_development",
        "inputs": [
          "analyze"
        ],
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "prompt"
        ]
      },
      {
        "id": "judge",
        "kind": "per_asset_judge",
        "inputs": [
          "generate"
        ],
        "required": true
      },
      {
        "id": "repair",
        "kind": "clip_level_repair",
        "inputs": [
          "judge"
        ],
        "eligible": true,
        "paid_retries": 1
      },
      {
        "id": "assemble",
        "kind": "segmented_assembly",
        "inputs": [
          "repair"
        ],
        "required": true
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "assemble"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 2,
      "label": "high",
      "paid_retries": 1,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "280b845810e54a6b048bdc5622e4c240280f665a08ee65ecafcd142fa3b489d9",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "hook-coverage",
        "moment_id": "hook",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "4de1f38917b655398416eedb8a5db4a7bd34008272ddc3d47efe2cb276246e05",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "hook-repair-1",
        "moment_id": "hook",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "74ca6bc8b3d172b56c8256ddd3629063cef79bc7b8f289ebdaf1fe1318c4d503",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "active_by_default": false
      }
    ],
    "task_count": 3,
    "candidate_task_count": 2,
    "repair_task_count": 1,
    "professional_control": {
      "contract_version": "professional-generation-control.v1",
      "desktop_capability_version": "professional-execution-capability.v1",
      "provider_identity": {
        "provider": "runway",
        "model": "gen4.5",
        "implementation_id": "implexa.runway.text-to-video.v1",
        "adapter_version": "1",
        "provider_version": "2024-11-06",
        "pricing_version": "2026-08-01",
        "auth_identity": {
          "kind": "local_key_vault",
          "provider": "runway",
          "binding": "authenticated_claiming_machine"
        }
      },
      "moments": [
        {
          "moment_id": "hook",
          "ordinal": 0,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "candidate_task_ids": [
            "hook-primary",
            "hook-coverage"
          ],
          "repair_task_id": "hook-repair-1",
          "depends_on_moment_ids": []
        }
      ],
      "authorization_tasks": [
        {
          "task_id": "hook-primary",
          "moment_id": "hook",
          "variant": "primary",
          "candidate_ordinal": 1,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
          "prompt_digest": "280b845810e54a6b048bdc5622e4c240280f665a08ee65ecafcd142fa3b489d9",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "paid_retries": 0,
          "paid_alternatives": 0,
          "task_kind": "candidate",
          "active_by_default": true
        },
        {
          "task_id": "hook-coverage",
          "moment_id": "hook",
          "variant": "coverage",
          "candidate_ordinal": 2,
          "timestamp": {
            "start_seconds": 0,
            "end_seconds": 3
          },
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
          "prompt_digest": "4de1f38917b655398416eedb8a5db4a7bd34008272ddc3d47efe2cb276246e05",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "paid_retries": 0,
          "paid_alternatives": 0,
          "task_kind": "candidate",
          "active_by_default": true
        },
        {
          "task_id": "hook-repair-1",
          "moment_id": "hook",
          "task_kind": "repair",
          "repair_ordinal": 1,
          "model": "gen4.5",
          "prompt_text": "a camera moving over bay area bridge. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
          "prompt_digest": "74ca6bc8b3d172b56c8256ddd3629063cef79bc7b8f289ebdaf1fe1318c4d503",
          "ratio": "720:1280",
          "duration_seconds": 3,
          "credits": 36,
          "active_by_default": false
        }
      ],
      "dependency_graph": [
        {
          "node_id": "hook-primary",
          "depends_on": []
        },
        {
          "node_id": "hook-coverage",
          "depends_on": []
        },
        {
          "node_id": "hook-repair-1",
          "depends_on": [
            "hook-primary",
            "hook-coverage"
          ]
        },
        {
          "node_id": "select-hook",
          "depends_on": [
            "hook-primary",
            "hook-coverage",
            "hook-repair-1"
          ]
        },
        {
          "node_id": "segment-ready-hook",
          "depends_on": [
            "select-hook"
          ]
        }
      ],
      "repair_policy": {
        "max_repairs_per_moment": 1,
        "requires_exactly_one_failed_candidate": true,
        "requires_typed_judge_failure": true,
        "new_approval_identity_forbidden": true
      },
      "selection_policy": {
        "exactly_one_per_moment": true,
        "validated_artifact_required": true,
        "artifact_digest_required": true,
        "typed_judge_pass_required": true
      },
      "cost": {
        "initial_credits": 72,
        "repair_reserve_credits": 36,
        "maximum_credits": 108
      },
      "assembly": {
        "projection_only": true,
        "final_render_authorized": false
      },
      "graph_digest": "1956d4cc09e927bdebb0ee6a8974b85417caaab52382e0bb2124081321c0e344"
    },
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      },
      {
        "task_id": "hook-coverage",
        "credits": 36
      },
      {
        "task_id": "hook-repair-1",
        "credits": 36
      }
    ],
    "maximum_credits": 108,
    "review_requirements": [
      "per_asset_judge",
      "clip_level_repair_eligible",
      "segmented_assembly",
      "user_review"
    ],
    "proposal_digest": "1feb2d4720c695cf5d4be1dc60be1e8f4b2e15d3fa9a670f1f1dd6c629cbce8d"
  }
} as const;

export const V1_PREVIEW_PRODUCTION = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": false,
  "unavailable_reason": "missing_required_production_capabilities",
  "required_missing_capabilities": [
    "video.judge.per_asset",
    "video.orchestration.segmented_assembly"
  ],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "production",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": false,
    "unavailable_reason": "missing_required_production_capabilities",
    "required_missing_capabilities": [
      "video.judge.per_asset",
      "video.orchestration.segmented_assembly"
    ],
    "stages": [],
    "density_policy": {
      "generations_per_moment": null,
      "label": null,
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": null,
    "tasks": [],
    "task_count": 0,
    "per_task_credits": [],
    "maximum_credits": 0,
    "review_requirements": [],
    "proposal_digest": "5e64596ec6fa763d4791d5ca0e0b512819330e6e28c520ffbfb047a220efc020"
  }
} as const;

export const V1_CREATE_FAST = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "state": "awaiting_approval",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "created_at": "2026-08-04T17:00:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "fast",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "plan",
        "kind": "minimal_planning",
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "plan"
        ]
      },
      {
        "id": "validate",
        "kind": "deterministic_validation",
        "inputs": [
          "generate"
        ]
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "validate"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 1,
      "label": "low",
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge",
        "prompt_digest": "ee6743014f7773982d9555b9538743436a4dbe6d31da13184b2b41bc49a75c0a",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0
      }
    ],
    "task_count": 1,
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      }
    ],
    "maximum_credits": 36,
    "review_requirements": [
      "deterministic_validation",
      "user_review"
    ],
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8"
  }
} as const;

export const V1_GET_FAST = {
  "ok": true,
  "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
  "lifecycle_state": "awaiting_approval",
  "progress_state": "awaiting_approval",
  "availability": true,
  "unavailable_reason": null,
  "identity": {
    "user_id": "3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11",
    "organization_id": "9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55",
    "agent_subject": "daily-ig-reel",
    "capability_key": "video.generate_broll",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "proposal_id": "d41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43",
    "proposal_version": "generation-quality.v1",
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8",
    "authorization_id": null,
    "authorization_digest": null
  },
  "expires_at": "2026-08-04T17:30:00.000Z",
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "fast",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "plan",
        "kind": "minimal_planning",
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "plan"
        ]
      },
      {
        "id": "validate",
        "kind": "deterministic_validation",
        "inputs": [
          "generate"
        ]
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "validate"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 1,
      "label": "low",
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge",
        "prompt_digest": "ee6743014f7773982d9555b9538743436a4dbe6d31da13184b2b41bc49a75c0a",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0
      }
    ],
    "task_count": 1,
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      }
    ],
    "maximum_credits": 36,
    "review_requirements": [
      "deterministic_validation",
      "user_review"
    ],
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8"
  },
  "cost": {
    "total_credits": 0,
    "maximum_credits": 36
  },
  "authorization": null,
  "task_progress": [],
  "receipt": null,
  "review_artifacts": []
} as const;

export const V1_PREVIEW_FAST_EXPLICIT_V1_REQUEST = {
  "ok": true,
  "proposal_id": null,
  "state": "proposed",
  "availability": true,
  "unavailable_reason": null,
  "required_missing_capabilities": [],
  "identity": {
    "capability_key": "video.generate_broll",
    "agent_subject": "daily-ig-reel",
    "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
    "source_request_id": null,
    "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
    "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "media_duration_ms": 600000
  },
  "expires_at": null,
  "created_at": null,
  "proposal": {
    "contract_version": "2026-08-01",
    "compiler_version": "generation-quality.v1",
    "capability_key": "video.generate_broll",
    "quality_mode": "fast",
    "source_binding": {
      "source_run_id": "7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77",
      "source_artifact_id": "b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134",
      "source_artifact_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "media_duration_ms": 600000,
      "windows": [
        {
          "moment_id": "hook",
          "start_ms": 0,
          "end_ms": 3000
        }
      ]
    },
    "availability": true,
    "unavailable_reason": null,
    "required_missing_capabilities": [],
    "stages": [
      {
        "id": "plan",
        "kind": "minimal_planning",
        "deterministic": true
      },
      {
        "id": "generate",
        "kind": "paid_generation",
        "inputs": [
          "plan"
        ]
      },
      {
        "id": "validate",
        "kind": "deterministic_validation",
        "inputs": [
          "generate"
        ]
      },
      {
        "id": "review",
        "kind": "user_review",
        "inputs": [
          "validate"
        ]
      }
    ],
    "density_policy": {
      "generations_per_moment": 1,
      "label": "low",
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    "pins": {
      "provider": "runway",
      "model": "gen4.5",
      "implementation_id": "implexa.runway.text-to-video.v1",
      "adapter_version": "1",
      "provider_version": "2024-11-06",
      "pricing_version": "2026-08-01"
    },
    "tasks": [
      {
        "task_id": "hook-primary",
        "moment_id": "hook",
        "variant": "primary",
        "timestamp": {
          "start_seconds": 0,
          "end_seconds": 3
        },
        "model": "gen4.5",
        "prompt_text": "a camera moving over bay area bridge",
        "prompt_digest": "ee6743014f7773982d9555b9538743436a4dbe6d31da13184b2b41bc49a75c0a",
        "ratio": "720:1280",
        "duration_seconds": 3,
        "credits": 36,
        "paid_retries": 0,
        "paid_alternatives": 0
      }
    ],
    "task_count": 1,
    "per_task_credits": [
      {
        "task_id": "hook-primary",
        "credits": 36
      }
    ],
    "maximum_credits": 36,
    "review_requirements": [
      "deterministic_validation",
      "user_review"
    ],
    "proposal_digest": "bfa609d8b75c71c8f3a6dec0579b33fd43b9117af1c212a91eb4c07f1581fde8"
  }
} as const;
