import { describe, expect, it } from "vitest";
import { createContinuityPacket, relevantDecisions } from "../server/src/continuity";
import type { ProjectOverview } from "../shared/types";

function overview(): ProjectOverview {
  return {
    project: {
      id: "p1",
      name: "Continuity Demo",
      description: "A long-running project.",
      category: "software",
      status: "active",
      created_at: "",
      updated_at: "",
      goals: ["Keep context compact"],
      current_state_summary: "A universal continuity service with sourced project memory.",
      health_score: 80,
      tags: []
    },
    events: Array.from({ length: 10 }, (_, index) => ({
      id: `e${index}`,
      project_id: "p1",
      event_type: "update",
      summary: `Change ${index}`,
      source: "test",
      timestamp: `2026-01-0${index}T00:00:00.000Z`,
      related_decision_ids: [],
      related_task_ids: []
    })),
    decisions: [
      {
        id: "d1",
        project_id: "p1",
        decision: "Use a local API bridge for assistants",
        rationale: "It keeps Azari and other clients separate while sharing compact context.",
        constraints: ["local-first"],
        tradeoffs: [],
        alternatives_considered: [],
        failed_paths: [],
        served_goal: "Reduce token load",
        reversal_conditions: [],
        confidence: 0.9,
        source: "test",
        timestamp: "2026-01-01T00:00:00.000Z"
      }
    ],
    concepts: [],
    branches: [{ id: "b1", project_id: "p1", branch_name: "Plugin bridge", description: "", status: "unresolved", reason_created: "", current_summary: "Future client bridge.", linked_decisions: [], timestamp: "" }],
    tasks: [{ id: "t1", project_id: "p1", task: "Document continuity packet", status: "blocked", priority: 2, rationale: "", linked_decision: "", blocker_reason: "Needs API shape", created_at: "", updated_at: "" }],
    driftWarnings: [{ id: "w1", project_id: "p1", drift_type: "missing-context", description: "Needs review.", severity: 2, evidence: [], suggested_review: "Review context packet assumptions.", timestamp: "" }],
    latestHealthReport: undefined,
    pendingDrafts: [],
    folderSnapshots: [],
    checks: [{ id: "c1", project_id: "p1", command: "npm test", check_type: "test", source: "package.json", confidence: 0.95, last_seen: "" }],
    signals: [{ id: "s1", project_id: "p1", signal_type: "stability-risk", label: "Blocked task present", description: "A blocked task needs review.", severity: 2, source: "test", timestamp: "" }]
  };
}

describe("continuity packets", () => {
  it("honors budget sizes while keeping key project signals", () => {
    const small = createContinuityPacket(overview(), "small");
    const large = createContinuityPacket(overview(), "large");

    expect(small.recent_changes.length).toBeLessThan(large.recent_changes.length);
    expect(small.detected_checks[0].command).toBe("npm test");
    expect(small.recommended_next_review).toContain("blocked task");
    expect(small.approximate_tokens).toBeGreaterThan(0);
  });

  it("finds relevant decisions by topic", () => {
    const result = relevantDecisions(overview(), "Azari local API bridge tokens");

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].relevance_score).toBeGreaterThan(1);
  });
});
