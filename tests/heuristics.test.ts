import { describe, expect, it } from "vitest";
import { HeuristicAdapter } from "../server/src/ai";
import type { ProjectOverview } from "../shared/types";

describe("heuristic adapter", () => {
  it("extracts draft records from a project update without mutating durable state", async () => {
    const adapter = new HeuristicAdapter();
    const draft = await adapter.extractProjectUpdate({
      projectName: "Azari Tendril Reach",
      currentSummary: "",
      goals: [],
      note: [
        "Goal: keep the project coherent over time.",
        "Decision: use a local-first SQLite persistence layer because project state should remain durable.",
        "Task: build the first intake workflow.",
        "Branch: maybe integrate with GitHub later.",
        "No longer treat this as a normal chatbot."
      ].join("\n")
    });

    expect(draft.goals).toContain("keep the project coherent over time.");
    expect(draft.decisions[0].decision).toContain("use a local-first SQLite persistence layer");
    expect(draft.tasks[0].task).toContain("build the first intake workflow");
    expect(draft.branches[0].branch_name).toContain("maybe integrate");
    expect(draft.driftWarnings.some((warning) => warning.drift_type === "direction-change")).toBe(true);
  });

  it("generates health scores from accepted overview state", async () => {
    const adapter = new HeuristicAdapter();
    const report = await adapter.generateHealthReport({
      project: { id: "p1", name: "Demo", description: "", category: "software", status: "active", created_at: "", updated_at: "", goals: [], current_state_summary: "", health_score: 0, tags: [] },
      events: [],
      decisions: [{ id: "d1", project_id: "p1", decision: "Use review flow", rationale: "", constraints: [], tradeoffs: [], alternatives_considered: [], failed_paths: [], served_goal: "", reversal_conditions: ["If users need speed"], confidence: 0.5, source: "", timestamp: "" }],
      concepts: [],
      branches: [{ id: "b1", project_id: "p1", branch_name: "GitHub", description: "", status: "unresolved", reason_created: "", current_summary: "", linked_decisions: [], timestamp: "" }],
      tasks: [{ id: "t1", project_id: "p1", task: "Wire export", status: "blocked", priority: 2, rationale: "", linked_decision: "", blocker_reason: "waiting", created_at: "", updated_at: "" }],
      driftWarnings: [{ id: "w1", project_id: "p1", drift_type: "contradiction", description: "Goals conflict", severity: 3, evidence: [], suggested_review: "", timestamp: "" }],
      pendingDrafts: [],
      folderSnapshots: [],
      checks: [],
      signals: [],
      workflowRuns: []
    } satisfies ProjectOverview);

    expect(report.unresolved_branch_count).toBe(1);
    expect(report.blocked_task_count).toBe(1);
    expect(report.stale_assumption_count).toBe(1);
    expect(report.contradiction_count).toBe(1);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});
