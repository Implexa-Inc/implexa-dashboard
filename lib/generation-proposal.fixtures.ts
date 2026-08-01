/**
 * EXACT compiler fixtures generated from backend PR #130 head
 * 19fc508091134b09a4a61799d411a18eccdef332 (generation-quality.v1 / 2026-08-01).
 * Run with IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:generation.
 * The generator refuses any other backend HEAD.
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
      "paid_retries": 0
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
      "prompt_text": "Founder opens laptop in dim room, screen glow on face. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "354486bdc159bee2988cbd48f764cf644865267e5e6517c34a11cc8957431eaa",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    {
      "task_id": "hook-coverage",
      "moment_id": "hook",
      "variant": "coverage",
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
      "prompt_text": "Terminal scrolling with agent build output, close-up. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "c5d39309ee704c843cc487f52fc2c406c6464d37bfc57c7b0ebbb6fa13a33cdc",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    {
      "task_id": "build-coverage",
      "moment_id": "build",
      "variant": "coverage",
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
      "prompt_text": "Phone screen showing finished reel, hand scrolling. Cinematic continuity, intentional camera movement, coherent subject motion, production-ready lighting. Primary composition.",
      "prompt_digest": "0ef5d9d1c825634ad99077ca3373273790b69b304752395db098abb91064eaf0",
      "ratio": "720:1280",
      "duration_seconds": 5,
      "credits": 60,
      "paid_retries": 0,
      "paid_alternatives": 0
    },
    {
      "task_id": "result-coverage",
      "moment_id": "result",
      "variant": "coverage",
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
      "paid_alternatives": 0
    }
  ],
  "task_count": 6,
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
      "task_id": "build-primary",
      "credits": 60
    },
    {
      "task_id": "build-coverage",
      "credits": 60
    },
    {
      "task_id": "result-primary",
      "credits": 60
    },
    {
      "task_id": "result-coverage",
      "credits": 60
    }
  ],
  "maximum_credits": 360,
  "review_requirements": [
    "per_asset_judge",
    "clip_level_repair_eligible",
    "segmented_assembly",
    "user_review"
  ],
  "proposal_digest": "714b6db2bd0c0ee6d1fd5aad0068db7a5a63ec7419246cc8ab49dac5c9aa0325"
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
