/**
 * EXACT compiler fixtures generated from backend main
 * 7890af350ccfe9eaf4dd658c77342357e7653aab (generation-quality.v1 / 2026-08-01).
 * Run with IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:generation.
 * The generator refuses any other backend HEAD.
 *
 * Professional compiles a bounded repair reserve into `tasks` alongside the two
 * candidates, so each moment carries THREE tasks. PROFESSIONAL_LIVE_COMPILED is
 * the single-moment 3-second shape the browser entry point actually builds, in
 * its approvable disposition, at the 108-credit ceiling.
 */

export const FAST_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "fast",
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
    },
    {
      "task_id": "result-primary",
      "moment_id": "result",
      "variant": "primary",
      "timestamp": {
        "start_seconds": 30,
        "end_seconds": 35
      },
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling",
      "prompt_digest": "b8efd9d89e27396b7a762001184dbe72d0e28d4cfe2a18c0c3bd68ce10e83fee",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0
    }
  ],
  "task_count": 3,
  "per_task_credits": [
    {
      "task_id": "hook-primary",
      "credits": 60
    },
    {
      "task_id": "build-primary",
      "credits": 60
    },
    {
      "task_id": "result-primary",
      "credits": 60
    }
  ],
  "maximum_credits": 180,
  "review_requirements": [
    "deterministic_validation",
    "user_review"
  ],
  "proposal_digest": "57bf0fc2a47a946fbd2075db1db9c60e35988351abb9f0ddbd9d3ea0d31cfe61"
} as const;

export const PROFESSIONAL_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "professional",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "video.judge.per_asset",
    "video.orchestration.segmented_assembly"
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
        "end_seconds": 5
      },
      "model": "gen4.5",
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "354486bdc159bee2988cbd48f764cf644865267e5e6517c34a11cc8957431eaa",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
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
        "end_seconds": 5
      },
      "model": "gen4.5",
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "f86aa36116f8b79463a65641a4a169c4304699386bd66f36ed9db69fa7b93fb2",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
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
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "d0d123c1f1411967fd1f4c1ba693e31c567e48d5453694f1d43b67df834ab279",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    },
    {
      "task_id": "build-primary",
      "moment_id": "build",
      "variant": "primary",
      "candidate_ordinal": 1,
      "timestamp": {
        "start_seconds": 12,
        "end_seconds": 17
      },
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "c5d39309ee704c843cc487f52fc2c406c6464d37bfc57c7b0ebbb6fa13a33cdc",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "build-coverage",
      "moment_id": "build",
      "variant": "coverage",
      "candidate_ordinal": 2,
      "timestamp": {
        "start_seconds": 12,
        "end_seconds": 17
      },
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "7ec4f5d4c4fa430dca1ff10c842a045646d821e3da0b6a037c3bdfbf3d62e3d9",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "build-repair-1",
      "moment_id": "build",
      "task_kind": "repair",
      "repair_ordinal": 1,
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "c1b55424b2d3fd2d582f0c303ad54ee2ddf188751e7d2920312a8ea9a0e90228",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    },
    {
      "task_id": "result-primary",
      "moment_id": "result",
      "variant": "primary",
      "candidate_ordinal": 1,
      "timestamp": {
        "start_seconds": 30,
        "end_seconds": 35
      },
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "0ef5d9d1c825634ad99077ca3373273790b69b304752395db098abb91064eaf0",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "result-coverage",
      "moment_id": "result",
      "variant": "coverage",
      "candidate_ordinal": 2,
      "timestamp": {
        "start_seconds": 30,
        "end_seconds": 35
      },
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "235ec32928dc72b400f2f56e4042ff739890fffd865fb00ec1b51249f12c2a1a",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "result-repair-1",
      "moment_id": "result",
      "task_kind": "repair",
      "repair_ordinal": 1,
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "9dd93e75192d160fa30c6d7b73da58dd6eefe7f1ba7591728337826f48f53fe5",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    }
  ],
  "task_count": 9,
  "candidate_task_count": 6,
  "repair_task_count": 3,
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
          "end_seconds": 5
        },
        "candidate_task_ids": [
          "hook-primary",
          "hook-coverage"
        ],
        "repair_task_id": "hook-repair-1",
        "depends_on_moment_ids": []
      },
      {
        "moment_id": "build",
        "ordinal": 1,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "candidate_task_ids": [
          "build-primary",
          "build-coverage"
        ],
        "repair_task_id": "build-repair-1",
        "depends_on_moment_ids": [
          "hook"
        ]
      },
      {
        "moment_id": "result",
        "ordinal": 2,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "candidate_task_ids": [
          "result-primary",
          "result-coverage"
        ],
        "repair_task_id": "result-repair-1",
        "depends_on_moment_ids": [
          "build"
        ]
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
          "end_seconds": 5
        },
        "model": "gen4.5",
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "354486bdc159bee2988cbd48f764cf644865267e5e6517c34a11cc8957431eaa",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
          "end_seconds": 5
        },
        "model": "gen4.5",
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "f86aa36116f8b79463a65641a4a169c4304699386bd66f36ed9db69fa7b93fb2",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "d0d123c1f1411967fd1f4c1ba693e31c567e48d5453694f1d43b67df834ab279",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "active_by_default": false
      },
      {
        "task_id": "build-primary",
        "moment_id": "build",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "c5d39309ee704c843cc487f52fc2c406c6464d37bfc57c7b0ebbb6fa13a33cdc",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "build-coverage",
        "moment_id": "build",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "7ec4f5d4c4fa430dca1ff10c842a045646d821e3da0b6a037c3bdfbf3d62e3d9",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "build-repair-1",
        "moment_id": "build",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "c1b55424b2d3fd2d582f0c303ad54ee2ddf188751e7d2920312a8ea9a0e90228",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "active_by_default": false
      },
      {
        "task_id": "result-primary",
        "moment_id": "result",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "0ef5d9d1c825634ad99077ca3373273790b69b304752395db098abb91064eaf0",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "result-coverage",
        "moment_id": "result",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "235ec32928dc72b400f2f56e4042ff739890fffd865fb00ec1b51249f12c2a1a",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "result-repair-1",
        "moment_id": "result",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "9dd93e75192d160fa30c6d7b73da58dd6eefe7f1ba7591728337826f48f53fe5",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
      },
      {
        "node_id": "build-primary",
        "depends_on": []
      },
      {
        "node_id": "build-coverage",
        "depends_on": []
      },
      {
        "node_id": "build-repair-1",
        "depends_on": [
          "build-primary",
          "build-coverage"
        ]
      },
      {
        "node_id": "select-build",
        "depends_on": [
          "build-primary",
          "build-coverage",
          "build-repair-1"
        ]
      },
      {
        "node_id": "segment-ready-build",
        "depends_on": [
          "select-build"
        ]
      },
      {
        "node_id": "result-primary",
        "depends_on": []
      },
      {
        "node_id": "result-coverage",
        "depends_on": []
      },
      {
        "node_id": "result-repair-1",
        "depends_on": [
          "result-primary",
          "result-coverage"
        ]
      },
      {
        "node_id": "select-result",
        "depends_on": [
          "result-primary",
          "result-coverage",
          "result-repair-1"
        ]
      },
      {
        "node_id": "segment-ready-result",
        "depends_on": [
          "select-result"
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
      "initial_credits": 360,
      "repair_reserve_credits": 180,
      "maximum_credits": 540
    },
    "assembly": {
      "projection_only": true,
      "final_render_authorized": false
    },
    "graph_digest": "51b76ef047fc42defa0cce0370e988d78433f27e47e45fabf46ed33341cb0ad6"
  },
  "per_task_credits": [
    {
      "task_id": "hook-primary",
      "credits": 60
    },
    {
      "task_id": "hook-coverage",
      "credits": 60
    },
    {
      "task_id": "hook-repair-1",
      "credits": 60
    },
    {
      "task_id": "build-primary",
      "credits": 60
    },
    {
      "task_id": "build-coverage",
      "credits": 60
    },
    {
      "task_id": "build-repair-1",
      "credits": 60
    },
    {
      "task_id": "result-primary",
      "credits": 60
    },
    {
      "task_id": "result-coverage",
      "credits": 60
    },
    {
      "task_id": "result-repair-1",
      "credits": 60
    }
  ],
  "maximum_credits": 540,
  "review_requirements": [
    "per_asset_judge",
    "clip_level_repair_eligible",
    "segmented_assembly",
    "user_review"
  ],
  "proposal_digest": "c64645617ce3d8ea53b012eef8c5ce8914aaf7c4e72d287fe15e2ace66762004"
} as const;

export const PROFESSIONAL_AVAILABLE_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "professional",
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
        "end_seconds": 5
      },
      "model": "gen4.5",
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "354486bdc159bee2988cbd48f764cf644865267e5e6517c34a11cc8957431eaa",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
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
        "end_seconds": 5
      },
      "model": "gen4.5",
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "f86aa36116f8b79463a65641a4a169c4304699386bd66f36ed9db69fa7b93fb2",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
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
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "d0d123c1f1411967fd1f4c1ba693e31c567e48d5453694f1d43b67df834ab279",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    },
    {
      "task_id": "build-primary",
      "moment_id": "build",
      "variant": "primary",
      "candidate_ordinal": 1,
      "timestamp": {
        "start_seconds": 12,
        "end_seconds": 17
      },
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "c5d39309ee704c843cc487f52fc2c406c6464d37bfc57c7b0ebbb6fa13a33cdc",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "build-coverage",
      "moment_id": "build",
      "variant": "coverage",
      "candidate_ordinal": 2,
      "timestamp": {
        "start_seconds": 12,
        "end_seconds": 17
      },
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "7ec4f5d4c4fa430dca1ff10c842a045646d821e3da0b6a037c3bdfbf3d62e3d9",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "build-repair-1",
      "moment_id": "build",
      "task_kind": "repair",
      "repair_ordinal": 1,
      "model": "gen4.5",
      "prompt_text": "Terminal scrolling with agent build output, close-up. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "c1b55424b2d3fd2d582f0c303ad54ee2ddf188751e7d2920312a8ea9a0e90228",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    },
    {
      "task_id": "result-primary",
      "moment_id": "result",
      "variant": "primary",
      "candidate_ordinal": 1,
      "timestamp": {
        "start_seconds": 30,
        "end_seconds": 35
      },
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "0ef5d9d1c825634ad99077ca3373273790b69b304752395db098abb91064eaf0",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "result-coverage",
      "moment_id": "result",
      "variant": "coverage",
      "candidate_ordinal": 2,
      "timestamp": {
        "start_seconds": 30,
        "end_seconds": 35
      },
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
      "prompt_digest": "235ec32928dc72b400f2f56e4042ff739890fffd865fb00ec1b51249f12c2a1a",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0,
      "task_kind": "candidate",
      "active_by_default": true
    },
    {
      "task_id": "result-repair-1",
      "moment_id": "result",
      "task_kind": "repair",
      "repair_ordinal": 1,
      "model": "gen4.5",
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
      "prompt_digest": "9dd93e75192d160fa30c6d7b73da58dd6eefe7f1ba7591728337826f48f53fe5",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "active_by_default": false
    }
  ],
  "task_count": 9,
  "candidate_task_count": 6,
  "repair_task_count": 3,
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
          "end_seconds": 5
        },
        "candidate_task_ids": [
          "hook-primary",
          "hook-coverage"
        ],
        "repair_task_id": "hook-repair-1",
        "depends_on_moment_ids": []
      },
      {
        "moment_id": "build",
        "ordinal": 1,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "candidate_task_ids": [
          "build-primary",
          "build-coverage"
        ],
        "repair_task_id": "build-repair-1",
        "depends_on_moment_ids": [
          "hook"
        ]
      },
      {
        "moment_id": "result",
        "ordinal": 2,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "candidate_task_ids": [
          "result-primary",
          "result-coverage"
        ],
        "repair_task_id": "result-repair-1",
        "depends_on_moment_ids": [
          "build"
        ]
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
          "end_seconds": 5
        },
        "model": "gen4.5",
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "354486bdc159bee2988cbd48f764cf644865267e5e6517c34a11cc8957431eaa",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
          "end_seconds": 5
        },
        "model": "gen4.5",
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "f86aa36116f8b79463a65641a4a169c4304699386bd66f36ed9db69fa7b93fb2",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
        "prompt_text": "Founder opens laptop in dim room, screen glow on face. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "d0d123c1f1411967fd1f4c1ba693e31c567e48d5453694f1d43b67df834ab279",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "active_by_default": false
      },
      {
        "task_id": "build-primary",
        "moment_id": "build",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "c5d39309ee704c843cc487f52fc2c406c6464d37bfc57c7b0ebbb6fa13a33cdc",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "build-coverage",
        "moment_id": "build",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 12,
          "end_seconds": 17
        },
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "7ec4f5d4c4fa430dca1ff10c842a045646d821e3da0b6a037c3bdfbf3d62e3d9",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "build-repair-1",
        "moment_id": "build",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "Terminal scrolling with agent build output, close-up. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "c1b55424b2d3fd2d582f0c303ad54ee2ddf188751e7d2920312a8ea9a0e90228",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "active_by_default": false
      },
      {
        "task_id": "result-primary",
        "moment_id": "result",
        "variant": "primary",
        "candidate_ordinal": 1,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
        "prompt_digest": "0ef5d9d1c825634ad99077ca3373273790b69b304752395db098abb91064eaf0",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "result-coverage",
        "moment_id": "result",
        "variant": "coverage",
        "candidate_ordinal": 2,
        "timestamp": {
          "start_seconds": 30,
          "end_seconds": 35
        },
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Complementary coverage with a distinct camera angle.",
        "prompt_digest": "235ec32928dc72b400f2f56e4042ff739890fffd865fb00ec1b51249f12c2a1a",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
        "paid_retries": 0,
        "paid_alternatives": 0,
        "task_kind": "candidate",
        "active_by_default": true
      },
      {
        "task_id": "result-repair-1",
        "moment_id": "result",
        "task_kind": "repair",
        "repair_ordinal": 1,
        "model": "gen4.5",
        "prompt_text": "Phone screen showing finished reel, hand scrolling. Corrective regeneration using the approved source intent; preserve the moment timing and aspect ratio; fix only independently judged defects.",
        "prompt_digest": "9dd93e75192d160fa30c6d7b73da58dd6eefe7f1ba7591728337826f48f53fe5",
        "ratio": "720:1280",
        "duration_seconds": 5,
        "credits": 60,
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
      },
      {
        "node_id": "build-primary",
        "depends_on": []
      },
      {
        "node_id": "build-coverage",
        "depends_on": []
      },
      {
        "node_id": "build-repair-1",
        "depends_on": [
          "build-primary",
          "build-coverage"
        ]
      },
      {
        "node_id": "select-build",
        "depends_on": [
          "build-primary",
          "build-coverage",
          "build-repair-1"
        ]
      },
      {
        "node_id": "segment-ready-build",
        "depends_on": [
          "select-build"
        ]
      },
      {
        "node_id": "result-primary",
        "depends_on": []
      },
      {
        "node_id": "result-coverage",
        "depends_on": []
      },
      {
        "node_id": "result-repair-1",
        "depends_on": [
          "result-primary",
          "result-coverage"
        ]
      },
      {
        "node_id": "select-result",
        "depends_on": [
          "result-primary",
          "result-coverage",
          "result-repair-1"
        ]
      },
      {
        "node_id": "segment-ready-result",
        "depends_on": [
          "select-result"
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
      "initial_credits": 360,
      "repair_reserve_credits": 180,
      "maximum_credits": 540
    },
    "assembly": {
      "projection_only": true,
      "final_render_authorized": false
    },
    "graph_digest": "51b76ef047fc42defa0cce0370e988d78433f27e47e45fabf46ed33341cb0ad6"
  },
  "per_task_credits": [
    {
      "task_id": "hook-primary",
      "credits": 60
    },
    {
      "task_id": "hook-coverage",
      "credits": 60
    },
    {
      "task_id": "hook-repair-1",
      "credits": 60
    },
    {
      "task_id": "build-primary",
      "credits": 60
    },
    {
      "task_id": "build-coverage",
      "credits": 60
    },
    {
      "task_id": "build-repair-1",
      "credits": 60
    },
    {
      "task_id": "result-primary",
      "credits": 60
    },
    {
      "task_id": "result-coverage",
      "credits": 60
    },
    {
      "task_id": "result-repair-1",
      "credits": 60
    }
  ],
  "maximum_credits": 540,
  "review_requirements": [
    "per_asset_judge",
    "clip_level_repair_eligible",
    "segmented_assembly",
    "user_review"
  ],
  "proposal_digest": "ee7aa63576d3aac54e2eb66193ac22c1200c84310f698d960e3db14925b32671"
} as const;

export const PRODUCTION_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "production",
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
  "proposal_digest": "349290be59fdd4da7080a297193739b93c86300c5056a751102dfb258567d75c"
} as const;

export const FAST_LIVE_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "fast",
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
  "proposal_digest": "dcef2158a9432ea29877514a5201454c7d9cb917a22eeacd831be04e412724e2"
} as const;

export const PROFESSIONAL_LIVE_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "professional",
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
  "proposal_digest": "48af5beb3f8614b64f9804c54ed30f99f11534151c59f9c18c2cb7625e794954"
} as const;

export const PROFESSIONAL_LIVE_UNAVAILABLE_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "professional",
  "availability": false,
  "unavailable_reason": "missing_required_professional_execution_capabilities",
  "required_missing_capabilities": [
    "video.judge.per_asset",
    "video.orchestration.segmented_assembly"
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
  "proposal_digest": "d09e7f16ad79f22a65eeeb1ead63c5de057a35f958fdb2e945ecfbda30d7072a"
} as const;

export const PRODUCTION_LIVE_COMPILED = {
  "contract_version": "2026-08-01",
  "compiler_version": "generation-quality.v1",
  "capability_key": "video.generate_broll",
  "quality_mode": "production",
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
  "proposal_digest": "349290be59fdd4da7080a297193739b93c86300c5056a751102dfb258567d75c"
} as const;
