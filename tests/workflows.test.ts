import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getWorkflowModules, runWorkflowModule } from "../server/src/workflows";
import type { ProjectOverview } from "../shared/types";

function overview(files: ProjectOverview["folderSnapshots"][number]["files"] = []): ProjectOverview {
  return {
    project: { id: "p1", name: "Workflow Demo", description: "", category: "software", status: "active", created_at: "", updated_at: "", goals: [], current_state_summary: "", health_score: 0, tags: [] },
    events: [],
    decisions: [],
    concepts: [],
    branches: [],
    tasks: [],
    driftWarnings: [],
    latestHealthReport: undefined,
    pendingDrafts: [],
    folderSnapshots: files.length ? [{ id: "s1", project_id: "p1", folder_path: "demo", source: "browser-selection", file_count: files.length, tracked_extensions: [".ts"], summary: "", files, timestamp: "" }] : [],
    checks: [],
    signals: [],
    workflowRuns: []
  };
}

describe("workflow modules", () => {
  it("registers the three MVP modules with review required by default", () => {
    const modules = getWorkflowModules();

    expect(modules.map((module) => module.id)).toEqual(["pr-reviewer", "doc-writer", "refactor-tracker"]);
    expect(modules.every((module) => module.review_required)).toBe(true);
  });

  it("returns stable advisory output for PR review", () => {
    const output = runWorkflowModule("pr-reviewer", overview(), { patch: "+ const result = eval(userInput);" });

    expect(output.summary).toContain("PR review");
    expect(output.findings.some((finding) => finding.category === "security")).toBe(true);
    expect(output.draft_comments.length).toBeGreaterThan(0);
    expect(output.continuity_updates.branch_suggestions.length).toBeGreaterThan(0);
  });

  it("fails gracefully when required context is missing", () => {
    expect(() => runWorkflowModule("pr-reviewer", overview(), {})).toThrow("requires patch");
    expect(() => runWorkflowModule("refactor-tracker", overview(), {})).toThrow("requires at least one folder snapshot");
  });

  it("detects documentation drift and refactor signals without writing files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pca-workflow-"));
    const target = path.join(root, "README.md");
    fs.writeFileSync(target, "original");

    const docs = runWorkflowModule("doc-writer", overview(), { changeNotes: "Added GET /api/workflows/modules endpoint." });
    const refactor = runWorkflowModule("refactor-tracker", overview([{ path: "src/app.ts", size: 20_000, kind: "text", excerpt: "// TODO split workflow handling" }]), {});

    expect(docs.findings.some((finding) => finding.category === "docs")).toBe(true);
    expect(refactor.findings.some((finding) => finding.title.includes("Unresolved marker"))).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
