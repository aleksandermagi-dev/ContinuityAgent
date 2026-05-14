import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/src/app";
import { createDb } from "../server/src/db";

const tempRoots: string[] = [];
const dbs: ReturnType<typeof createDb>[] = [];

function testApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pca-"));
  tempRoots.push(root);
  const db = createDb(path.join(root, "test.sqlite"));
  dbs.push(db);
  return createApp(db);
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project continuity api", () => {
  it("redirects root browser opens to the frontend dev surface", async () => {
    const app = testApp();
    const response = await request(app).get("/").expect(302);

    expect(response.headers.location).toBe("http://127.0.0.1:5173");
  });

  it("creates a project, drafts an update, accepts it, reports health, and exports markdown", async () => {
    const app = testApp();
    const created = await request(app).post("/api/projects").send({ name: "Azari Tendril Reach", description: "Demo continuity project" }).expect(201);
    const projectId = created.body.id;

    const update = await request(app)
      .post(`/api/projects/${projectId}/updates`)
      .send({ note: "Goal: preserve why-layer continuity.\nDecision: use review-before-accept because AI output is advisory.\nTask: generate a health report.\nBranch: explore GitHub integration later." })
      .expect(201);

    const overviewBefore = await request(app).get(`/api/projects/${projectId}/overview`).expect(200);
    expect(overviewBefore.body.pendingDrafts).toHaveLength(1);
    expect(overviewBefore.body.decisions).toHaveLength(0);

    await request(app).post(`/api/projects/${projectId}/extractions/${update.body.draft.run_id}/accept`).send({}).expect(200);
    const overviewAfter = await request(app).get(`/api/projects/${projectId}/overview`).expect(200);
    expect(overviewAfter.body.pendingDrafts).toHaveLength(0);
    expect(overviewAfter.body.decisions).toHaveLength(1);
    expect(overviewAfter.body.tasks).toHaveLength(1);

    const health = await request(app).post(`/api/projects/${projectId}/reports/health`).send({}).expect(201);
    expect(health.body.summary).toContain("Azari Tendril Reach");

    const markdown = await request(app).get(`/api/projects/${projectId}/export?format=markdown`).expect(200);
    expect(markdown.text).toContain("# Azari Tendril Reach");
    expect(markdown.text).toContain("review-before-accept");
  });

  it("creates a folder snapshot from a local path and turns it into a review draft", async () => {
    const app = testApp();
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pca-folder-"));
    tempRoots.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "README.md"), "Goal: connect this repo folder to project memory.\nDecision: scan folders as advisory snapshots.");

    const created = await request(app).post("/api/projects").send({ name: "Folder Demo" }).expect(201);
    const projectId = created.body.id;
    const snapshot = await request(app).post(`/api/projects/${projectId}/folder-snapshots`).send({ folderPath: projectRoot }).expect(201);

    expect(snapshot.body.snapshot.file_count).toBe(1);
    expect(snapshot.body.snapshot.tracked_extensions).toContain(".md");

    const overview = await request(app).get(`/api/projects/${projectId}/overview`).expect(200);
    expect(overview.body.folderSnapshots).toHaveLength(1);
    expect(overview.body.pendingDrafts).toHaveLength(1);
  });

  it("creates a project from a selected file with summary, checks, signals, and a draft", async () => {
    const app = testApp();
    const response = await request(app)
      .post("/api/projects/from-file")
      .send({
        fileName: "README.md",
        path: "Azari Tendril Reach/README.md",
        size: 128,
        text: "Goal: keep continuity stable.\nDecision: use suite checks.\nRun npm test and system_sweep before handoff."
      })
      .expect(201);

    expect(response.body.project.name).toBe("Azari Tendril Reach");
    expect(response.body.project.current_state_summary).toContain("keep continuity stable");
    expect(response.body.checks.some((check: { command: string }) => check.command === "npm test")).toBe(true);

    const overview = await request(app).get(`/api/projects/${response.body.project.id}/overview`).expect(200);
    expect(overview.body.pendingDrafts).toHaveLength(1);
    expect(overview.body.checks.length).toBeGreaterThan(0);
    expect(overview.body.signals.length).toBeGreaterThan(0);
  });

  it("scans project candidates and tracks one without auto-accepting extracted decisions", async () => {
    const app = testApp();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pca-scan-"));
    tempRoots.push(root);
    const projectRoot = path.join(root, "Azari Example");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "README.md"), "Goal: demonstrate project scanning.\nRun npm test.");
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run", build: "tsc -p tsconfig.json" } }));

    const scan = await request(app).post("/api/project-discovery/scan").send({ rootPath: root }).expect(200);
    expect(scan.body.candidates.length).toBeGreaterThan(0);
    expect(scan.body.warnings).toBeDefined();
    expect(scan.body.scanned_at).toBeDefined();
    expect(scan.body.candidates[0].detection_reasons).toContain("README found");
    expect(scan.body.candidates[0].detected_checks.some((check: { command: string }) => check.command === "npm run test")).toBe(true);

    const tracked = await request(app).post("/api/project-discovery/track").send({ candidate: scan.body.candidates[0] }).expect(201);
    const overview = await request(app).get(`/api/projects/${tracked.body.project.id}/overview`).expect(200);
    expect(overview.body.decisions).toHaveLength(0);
    expect(overview.body.pendingDrafts).toHaveLength(1);
    expect(overview.body.checks.length).toBeGreaterThan(0);

    const markdown = await request(app).get(`/api/projects/${tracked.body.project.id}/export?format=markdown`).expect(200);
    expect(markdown.text).toContain("Detected Checks");
  });

  it("serves continuity packets, relevant decisions, recent changes, and draft-only agent updates", async () => {
    const app = testApp();
    const created = await request(app).post("/api/projects").send({ name: "Agent Helper Demo", description: "Compact context service" }).expect(201);
    const projectId = created.body.id;
    const update = await request(app)
      .post(`/api/projects/${projectId}/updates`)
      .send({ note: "Decision: expose a local API bridge because assistants need token-budgeted continuity.\nTask: keep writes review-safe." })
      .expect(201);
    await request(app).post(`/api/projects/${projectId}/extractions/${update.body.draft.run_id}/accept`).send({}).expect(200);

    const packet = await request(app).get(`/api/projects/${projectId}/context-packet?budget=small`).expect(200);
    expect(packet.body.budget).toBe("small");
    expect(packet.body.summary).toContain("local API bridge");
    expect(packet.body.provenance.event_count).toBeGreaterThan(0);

    const relevant = await request(app).get(`/api/projects/${projectId}/decisions/relevant?topic=local%20API%20bridge`).expect(200);
    expect(relevant.body.decisions[0].decision).toContain("local API bridge");

    const recent = await request(app).get(`/api/projects/${projectId}/recent-changes`).expect(200);
    expect(recent.body.changes.length).toBeGreaterThan(0);

    const agentUpdate = await request(app)
      .post(`/api/projects/${projectId}/agent-updates`)
      .send({ note: "Decision: keep agent writes as drafts because durable memory needs review.", source: "azari-plugin-prototype" })
      .expect(201);
    expect(agentUpdate.body.review_required).toBe(true);

    const overview = await request(app).get(`/api/projects/${projectId}/overview`).expect(200);
    expect(overview.body.pendingDrafts.length).toBe(1);
    expect(overview.body.decisions).toHaveLength(1);
  });

  it("runs workflow modules and accepts or rejects advisory outputs", async () => {
    const app = testApp();
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pca-workflows-"));
    tempRoots.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "README.md"), "Goal: workflow demo.\nTODO document workflow review.");
    fs.writeFileSync(path.join(projectRoot, "index.ts"), "export function run() { return true; }\n".repeat(800));
    const created = await request(app).post("/api/projects").send({ name: "Workflow Demo" }).expect(201);
    const projectId = created.body.id;
    await request(app).post(`/api/projects/${projectId}/folder-snapshots`).send({ folderPath: projectRoot }).expect(201);

    const modules = await request(app).get("/api/workflows/modules").expect(200);
    expect(modules.body.map((module: { id: string }) => module.id)).toEqual(["pr-reviewer", "doc-writer", "refactor-tracker"]);
    expect(modules.body.every((module: { review_required: boolean }) => module.review_required)).toBe(true);

    const missing = await request(app).post(`/api/projects/${projectId}/workflows/pr-reviewer/run`).send({}).expect(400);
    expect(missing.body.error).toContain("requires patch");

    const prRun = await request(app)
      .post(`/api/projects/${projectId}/workflows/pr-reviewer/run`)
      .send({ patch: "+ const html = input.innerHTML;\n+ console.log(html);" })
      .expect(201);
    expect(prRun.body.status).toBe("draft");
    expect(prRun.body.review_required).toBe(true);
    expect(prRun.body.output.findings.some((finding: { category: string }) => finding.category === "security")).toBe(true);

    const docRun = await request(app)
      .post(`/api/projects/${projectId}/workflows/doc-writer/run`)
      .send({ changeNotes: "Added POST /api/projects/:id/workflows/:moduleId/run for workflow execution." })
      .expect(201);
    await request(app).post(`/api/projects/${projectId}/workflows/runs/${docRun.body.id}/reject`).send({ reason: "Will document later." }).expect(200);

    const refactorRun = await request(app).post(`/api/projects/${projectId}/workflows/refactor-tracker/run`).send({}).expect(201);
    const accepted = await request(app).post(`/api/projects/${projectId}/workflows/runs/${refactorRun.body.id}/accept`).send({}).expect(200);
    expect(accepted.body.events.some((event: { source: string }) => event.source === "workflow:refactor-tracker")).toBe(true);
    expect(accepted.body.branches.length).toBeGreaterThan(0);
    expect(accepted.body.driftWarnings.length).toBeGreaterThan(0);

    const runs = await request(app).get(`/api/projects/${projectId}/workflows/runs`).expect(200);
    expect(runs.body.some((run: { status: string }) => run.status === "rejected")).toBe(true);
    expect(runs.body.some((run: { status: string }) => run.status === "accepted")).toBe(true);
  });

  it("exposes the Azari Continuity Trial benchmark profile", async () => {
    const app = testApp();
    const profile = await request(app).get("/api/benchmarks/azari-continuity-trial").expect(200);

    expect(profile.body.name).toBe("Azari Continuity Trial");
    expect(profile.body.success_criteria.some((item: string) => item.includes("validation"))).toBe(true);
    expect(profile.body.expected_checks).toContain("validation");
  });
});
