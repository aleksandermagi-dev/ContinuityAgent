import cors from "cors";
import express from "express";
import { z } from "zod";
import { createAiAdapter } from "./ai";
import {
  acceptExtraction,
  createDb,
  createProject,
  getOverview,
  getProject,
  getProjectChecks,
  insertEvent,
  insertExtractionDraft,
  insertFolderSnapshot,
  insertHealthReport,
  listProjects,
  replaceProjectChecks,
  replaceProjectSignals,
  updateProjectSummary,
  type AppDb
} from "./db";
import {
  azariContinuityTrial,
  createContinuityPacket,
  recentChanges,
  relevantDecisions
} from "./continuity";
import {
  candidateFromFiles,
  createFileSnapshotFromBrowserFile,
  createFileSnapshotFromLocalPath,
  detectChecks,
  detectSignals,
  fileSnapshotToProjectFiles,
  scanBrowserProjects,
  scanLocalProjects,
  summarizeFileSnapshot
} from "./discovery";
import { toMarkdown } from "./export";
import { createSnapshotFromBrowserSelection, createSnapshotFromFiles, createSnapshotFromLocalPath, snapshotToUpdateNote } from "./folders";

export function createApp(db: AppDb = createDb()) {
  const app = express();
  const ai = createAiAdapter();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:5173";
    res.redirect(302, frontendUrl);
  });

  app.get("/api/projects", (_req, res) => {
    res.json(listProjects(db));
  });

  app.post("/api/projects", (req, res) => {
    const input = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional()
    }).parse(req.body);
    res.status(201).json(createProject(db, input));
  });

  app.post("/api/projects/from-file", async (req, res, next) => {
    try {
      const input = z.object({
        filePath: z.string().optional(),
        fileName: z.string().optional(),
        path: z.string().optional(),
        parentFolderName: z.string().optional(),
        size: z.number().optional(),
        text: z.string().optional()
      }).parse(req.body);
      const fileSnapshot = input.filePath
        ? createFileSnapshotFromLocalPath(input.filePath)
        : createFileSnapshotFromBrowserFile({
          fileName: input.fileName ?? input.path ?? "Imported file",
          path: input.path,
          size: input.size ?? input.text?.length ?? 0,
          text: input.text
        });
      const projectName = input.parentFolderName || fileSnapshot.parent_folder_name;
      const summary = summarizeFileSnapshot(fileSnapshot);
      const project = createProject(db, { name: projectName, description: summary, category: "imported", tags: ["file-import"] });
      updateProjectSummary(db, project.id, summary);

      const files = fileSnapshotToProjectFiles(fileSnapshot);
      const snapshot = createSnapshotFromFiles(project.id, projectName, "browser-selection", files, 1);
      insertFolderSnapshot(db, snapshot);
      const checks = replaceProjectChecks(db, project.id, detectChecks(files));
      const signals = replaceProjectSignals(db, project.id, detectSignals(files));
      const note = snapshotToUpdateNote(snapshot);
      const event = insertEvent(db, project.id, note, `file:${fileSnapshot.file_name}`);
      const payload = await ai.extractProjectUpdate({
        projectName: project.name,
        note,
        currentSummary: summary,
        goals: []
      });
      const draft = insertExtractionDraft(db, project.id, event.id, payload, ai.provider);
      res.status(201).json({ project: getProject(db, project.id), snapshot, draft, checks, signals });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    res.json(overview.project);
  });

  app.get("/api/projects/:id/overview", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    res.json(overview);
  });

  app.get("/api/projects/:id/context-packet", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    const budget = z.enum(["small", "medium", "large"]).default("medium").parse(req.query.budget ?? "medium");
    res.json(createContinuityPacket(overview, budget));
  });

  app.get("/api/projects/:id/decisions/relevant", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    const topic = z.string().default("").parse(req.query.topic ?? "");
    res.json(relevantDecisions(overview, topic));
  });

  app.get("/api/projects/:id/recent-changes", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    res.json(recentChanges(overview));
  });

  app.post("/api/projects/:id/updates", async (req, res, next) => {
    try {
      const input = z.object({
        note: z.string().min(1),
        source: z.string().default("manual")
      }).parse(req.body);
      const project = getProject(db, req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const event = insertEvent(db, project.id, input.note, input.source);
      const payload = await ai.extractProjectUpdate({
        projectName: project.name,
        note: input.note,
        currentSummary: project.current_state_summary,
        goals: project.goals
      });
      const draft = insertExtractionDraft(db, project.id, event.id, payload, ai.provider);
      res.status(201).json({ event, draft });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/agent-updates", async (req, res, next) => {
    try {
      const input = z.object({
        note: z.string().min(1),
        source: z.string().default("agent")
      }).parse(req.body);
      const project = getProject(db, req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const event = insertEvent(db, project.id, input.note, `agent:${input.source}`);
      const payload = await ai.extractProjectUpdate({
        projectName: project.name,
        note: input.note,
        currentSummary: project.current_state_summary,
        goals: project.goals
      });
      const draft = insertExtractionDraft(db, project.id, event.id, payload, ai.provider);
      res.status(201).json({ event, draft, review_required: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/folder-snapshots", async (req, res, next) => {
    try {
      const input = z.object({
        folderPath: z.string().optional(),
        folderName: z.string().optional(),
        files: z.array(z.object({
          path: z.string(),
          size: z.number(),
          text: z.string().optional()
        })).optional()
      }).parse(req.body);
      const project = getProject(db, req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!input.folderPath && !input.files?.length) return res.status(400).json({ error: "Provide a folderPath or selected files." });

      const snapshot = input.folderPath
        ? createSnapshotFromLocalPath(project.id, input.folderPath)
        : createSnapshotFromBrowserSelection(project.id, input.folderName ?? "Selected folder", input.files ?? []);
      insertFolderSnapshot(db, snapshot);
      replaceProjectChecks(db, project.id, detectChecks(snapshot.files));
      replaceProjectSignals(db, project.id, detectSignals(snapshot.files));

      const note = snapshotToUpdateNote(snapshot);
      const event = insertEvent(db, project.id, note, `folder:${snapshot.source}`);
      const payload = await ai.extractProjectUpdate({
        projectName: project.name,
        note,
        currentSummary: project.current_state_summary,
        goals: project.goals
      });
      const draft = insertExtractionDraft(db, project.id, event.id, payload, ai.provider);
      res.status(201).json({ snapshot, event, draft });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/project-discovery/scan", (req, res, next) => {
    try {
      const input = z.object({
        rootPath: z.string().optional(),
        folderName: z.string().optional(),
        files: z.array(z.object({
          path: z.string(),
          size: z.number(),
          text: z.string().optional()
        })).optional()
      }).parse(req.body);
      if (!input.rootPath && !input.files?.length) return res.status(400).json({ error: "Provide a rootPath or selected folder files." });
      const candidates = input.rootPath
        ? scanLocalProjects(input.rootPath)
        : scanBrowserProjects(input.folderName ?? "Selected folder", input.files ?? []);
      res.json({ candidates });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/project-discovery/track", async (req, res, next) => {
    try {
      const input = z.object({
        candidate: z.object({
          name: z.string(),
          path: z.string(),
          evidence_files: z.array(z.string()),
          readme_preview: z.string(),
          detected_stack: z.array(z.string()),
          detected_checks: z.array(z.object({
            command: z.string(),
            check_type: z.enum(["test", "build", "lint", "typecheck", "validation", "run", "unknown"]),
            source: z.string(),
            confidence: z.number()
          })),
          signals: z.array(z.object({
            signal_type: z.enum(["documentation", "entrypoint", "architecture", "why-layer", "stability-risk", "stack"]),
            label: z.string(),
            description: z.string(),
            severity: z.number(),
            source: z.string()
          })),
          files: z.array(z.object({
            path: z.string(),
            size: z.number(),
            kind: z.enum(["text", "binary", "skipped"]),
            excerpt: z.string().optional()
          })),
          source: z.enum(["browser-selection", "local-path"])
        })
      }).parse(req.body);
      const candidate = candidateFromFiles(input.candidate.name, input.candidate.path, input.candidate.source, input.candidate.files.map((file) => ({
        path: file.path,
        size: file.size,
        text: file.excerpt
      }))) ?? input.candidate;
      const summary = candidate.readme_preview || `Tracked project imported from ${candidate.path}.`;
      const project = createProject(db, { name: candidate.name, description: summary, category: candidate.detected_stack[0] ?? "imported", tags: ["tracked"] });
      updateProjectSummary(db, project.id, summary);
      const snapshot = createSnapshotFromFiles(project.id, candidate.path, candidate.source, candidate.files, candidate.files.length);
      insertFolderSnapshot(db, snapshot);
      const checks = replaceProjectChecks(db, project.id, candidate.detected_checks);
      const signals = replaceProjectSignals(db, project.id, candidate.signals);
      const event = insertEvent(db, project.id, snapshotToUpdateNote(snapshot), `discovery:${candidate.source}`);
      const payload = await ai.extractProjectUpdate({
        projectName: project.name,
        note: snapshotToUpdateNote(snapshot),
        currentSummary: summary,
        goals: []
      });
      const draft = insertExtractionDraft(db, project.id, event.id, payload, ai.provider);
      res.status(201).json({ project: getProject(db, project.id), snapshot, draft, checks, signals });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/extractions/:runId/accept", (req, res) => {
    const input = z.object({ sections: z.array(z.string()).optional() }).parse(req.body ?? {});
    const overview = acceptExtraction(db, req.params.id, req.params.runId, input.sections);
    if (!overview) return res.status(404).json({ error: "Pending extraction not found" });
    res.json(overview);
  });

  app.get("/api/projects/:id/health", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    res.json(overview.latestHealthReport ?? null);
  });

  app.get("/api/projects/:id/checks", (req, res) => {
    if (!getProject(db, req.params.id)) return res.status(404).json({ error: "Project not found" });
    res.json(getProjectChecks(db, req.params.id));
  });

  app.get("/api/benchmarks/azari-continuity-trial", (_req, res) => {
    res.json(azariContinuityTrial);
  });

  app.post("/api/projects/:id/reports/health", async (req, res, next) => {
    try {
      const overview = getOverview(db, req.params.id);
      if (!overview) return res.status(404).json({ error: "Project not found" });
      const report = await ai.generateHealthReport(overview);
      insertHealthReport(db, report);
      res.status(201).json(report);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/export", (req, res) => {
    const overview = getOverview(db, req.params.id);
    if (!overview) return res.status(404).json({ error: "Project not found" });
    if (req.query.format === "json") return res.json(overview);
    res.type("text/markdown").send(toMarkdown(overview));
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    res.status(400).json({ error: message });
  });

  return app;
}
