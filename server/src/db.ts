import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  BranchRecord,
  ConceptNode,
  DecisionRecord,
  DriftWarning,
  ExtractionDraft,
  ExtractionDraftPayload,
  ExtractionRun,
  FolderSnapshot,
  Project,
  ProjectCheck,
  ProjectEvent,
  ProjectHealthReport,
  ProjectOverview,
  ProjectSignal,
  ProjectStatus,
  TaskRecord
} from "../../shared/types";

const json = {
  parse<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  },
  stringify(value: unknown): string {
    return JSON.stringify(value ?? []);
  }
};

export function createDb(dbPath = process.env.PCA_DB_PATH ?? path.join(process.cwd(), "data", "project-continuity.sqlite")) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export type AppDb = ReturnType<typeof createDb>;

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      goals TEXT NOT NULL DEFAULT '[]',
      current_state_summary TEXT NOT NULL DEFAULT '',
      health_score INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS project_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      source TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      related_decision_ids TEXT NOT NULL DEFAULT '[]',
      related_task_ids TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS decision_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      constraints TEXT NOT NULL DEFAULT '[]',
      tradeoffs TEXT NOT NULL DEFAULT '[]',
      alternatives_considered TEXT NOT NULL DEFAULT '[]',
      failed_paths TEXT NOT NULL DEFAULT '[]',
      served_goal TEXT NOT NULL DEFAULT '',
      reversal_conditions TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      source TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      provenance_event_id TEXT,
      provenance_extraction_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS concept_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      concept_name TEXT NOT NULL,
      description TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      related_concepts TEXT NOT NULL DEFAULT '[]',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      provenance_event_id TEXT,
      provenance_extraction_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS branch_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      branch_name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      reason_created TEXT NOT NULL,
      current_summary TEXT NOT NULL,
      linked_decisions TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL,
      provenance_event_id TEXT,
      provenance_extraction_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS task_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 2,
      rationale TEXT NOT NULL,
      linked_decision TEXT NOT NULL DEFAULT '',
      blocker_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      provenance_event_id TEXT,
      provenance_extraction_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS drift_warnings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      drift_type TEXT NOT NULL,
      description TEXT NOT NULL,
      severity INTEGER NOT NULL DEFAULT 1,
      evidence TEXT NOT NULL DEFAULT '[]',
      suggested_review TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      provenance_event_id TEXT,
      provenance_extraction_run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS project_health_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      continuity_score INTEGER NOT NULL,
      drift_score INTEGER NOT NULL,
      unresolved_branch_count INTEGER NOT NULL,
      stale_assumption_count INTEGER NOT NULL,
      blocked_task_count INTEGER NOT NULL,
      contradiction_count INTEGER NOT NULL,
      summary TEXT NOT NULL,
      recommendations TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extraction_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extraction_drafts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folder_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      folder_path TEXT NOT NULL,
      source TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      tracked_extensions TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL,
      files TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_checks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      check_type TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_signals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      signal_type TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      severity INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
}

export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();

export function toProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    category: String(row.category ?? "general"),
    status: String(row.status ?? "active") as ProjectStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    goals: json.parse(String(row.goals ?? "[]"), []),
    current_state_summary: String(row.current_state_summary ?? ""),
    health_score: Number(row.health_score ?? 0),
    tags: json.parse(String(row.tags ?? "[]"), [])
  };
}

export function createProject(db: AppDb, input: { name: string; description?: string; category?: string; tags?: string[] }): Project {
  const timestamp = now();
  const project: Project = {
    id: id(),
    name: input.name,
    description: input.description ?? "",
    category: input.category ?? "general",
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
    goals: [],
    current_state_summary: input.description ?? "",
    health_score: 0,
    tags: input.tags ?? []
  };
  db.prepare(`
    INSERT INTO projects (id, name, description, category, status, created_at, updated_at, goals, current_state_summary, health_score, tags)
    VALUES (@id, @name, @description, @category, @status, @created_at, @updated_at, @goals, @current_state_summary, @health_score, @tags)
  `).run({ ...project, goals: json.stringify(project.goals), tags: json.stringify(project.tags) });
  return project;
}

export function listProjects(db: AppDb): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all().map((row) => toProject(row as Record<string, unknown>));
}

export function getProject(db: AppDb, projectId: string): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return row ? toProject(row as Record<string, unknown>) : undefined;
}

export function insertEvent(db: AppDb, projectId: string, summary: string, source: string): ProjectEvent {
  const event: ProjectEvent = {
    id: id(),
    project_id: projectId,
    event_type: "update",
    summary,
    source,
    timestamp: now(),
    related_decision_ids: [],
    related_task_ids: []
  };
  db.prepare(`
    INSERT INTO project_events (id, project_id, event_type, summary, source, timestamp, related_decision_ids, related_task_ids)
    VALUES (@id, @project_id, @event_type, @summary, @source, @timestamp, @related_decision_ids, @related_task_ids)
  `).run({
    ...event,
    related_decision_ids: json.stringify(event.related_decision_ids),
    related_task_ids: json.stringify(event.related_task_ids)
  });
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(event.timestamp, projectId);
  return event;
}

export function insertExtractionDraft(
  db: AppDb,
  projectId: string,
  eventId: string,
  payload: ExtractionDraftPayload,
  provider: string
): ExtractionDraft {
  const created_at = now();
  const run: ExtractionRun = { id: id(), project_id: projectId, event_id: eventId, status: "draft", provider, created_at };
  const draft: ExtractionDraft = { id: id(), run_id: run.id, project_id: projectId, event_id: eventId, payload, created_at };
  db.prepare("INSERT INTO extraction_runs (id, project_id, event_id, status, provider, created_at) VALUES (@id, @project_id, @event_id, @status, @provider, @created_at)").run(run);
  db.prepare("INSERT INTO extraction_drafts (id, run_id, project_id, event_id, payload, created_at) VALUES (@id, @run_id, @project_id, @event_id, @payload, @created_at)").run({
    ...draft,
    payload: json.stringify(payload)
  });
  return draft;
}

function mapRows<T>(db: AppDb, sql: string, projectId: string, mapper: (row: Record<string, unknown>) => T): T[] {
  return db.prepare(sql).all(projectId).map((row) => mapper(row as Record<string, unknown>));
}

export function getOverview(db: AppDb, projectId: string): ProjectOverview | undefined {
  const project = getProject(db, projectId);
  if (!project) return undefined;
  const events = mapRows(db, "SELECT * FROM project_events WHERE project_id = ? ORDER BY timestamp DESC", projectId, toEvent);
  const decisions = mapRows(db, "SELECT * FROM decision_records WHERE project_id = ? ORDER BY timestamp DESC", projectId, toDecision);
  const concepts = mapRows(db, "SELECT * FROM concept_nodes WHERE project_id = ? ORDER BY weight DESC, last_seen DESC", projectId, toConcept);
  const branches = mapRows(db, "SELECT * FROM branch_records WHERE project_id = ? ORDER BY timestamp DESC", projectId, toBranch);
  const tasks = mapRows(db, "SELECT * FROM task_records WHERE project_id = ? ORDER BY status, priority DESC, updated_at DESC", projectId, toTask);
  const driftWarnings = mapRows(db, "SELECT * FROM drift_warnings WHERE project_id = ? ORDER BY severity DESC, timestamp DESC", projectId, toDrift);
  const healthRow = db.prepare("SELECT * FROM project_health_reports WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1").get(projectId);
  const pendingDrafts = mapRows(db, "SELECT * FROM extraction_drafts WHERE project_id = ? AND accepted_at IS NULL ORDER BY created_at DESC", projectId, toDraft);
  const folderSnapshots = mapRows(db, "SELECT * FROM folder_snapshots WHERE project_id = ? ORDER BY timestamp DESC LIMIT 10", projectId, toFolderSnapshot);
  const checks = mapRows(db, "SELECT * FROM project_checks WHERE project_id = ? ORDER BY check_type, confidence DESC, command", projectId, toProjectCheck);
  const signals = mapRows(db, "SELECT * FROM project_signals WHERE project_id = ? ORDER BY severity DESC, timestamp DESC", projectId, toProjectSignal);
  return {
    project,
    events,
    decisions,
    concepts,
    branches,
    tasks,
    driftWarnings,
    latestHealthReport: healthRow ? toHealth(healthRow as Record<string, unknown>) : undefined,
    pendingDrafts,
    folderSnapshots,
    checks,
    signals
  };
}

export function updateProjectSummary(db: AppDb, projectId: string, summary: string) {
  const timestamp = now();
  db.prepare("UPDATE projects SET description = ?, current_state_summary = ?, updated_at = ? WHERE id = ?").run(summary, summary, timestamp, projectId);
}

export function insertFolderSnapshot(db: AppDb, snapshot: FolderSnapshot) {
  db.prepare(`
    INSERT INTO folder_snapshots (id, project_id, folder_path, source, file_count, tracked_extensions, summary, files, timestamp)
    VALUES (@id, @project_id, @folder_path, @source, @file_count, @tracked_extensions, @summary, @files, @timestamp)
  `).run({
    ...snapshot,
    tracked_extensions: json.stringify(snapshot.tracked_extensions),
    files: json.stringify(snapshot.files)
  });
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(snapshot.timestamp, snapshot.project_id);
}

export function replaceProjectChecks(db: AppDb, projectId: string, checks: Omit<ProjectCheck, "id" | "project_id" | "last_seen">[]): ProjectCheck[] {
  const timestamp = now();
  const rows = checks.map((check) => ({ ...check, id: id(), project_id: projectId, last_seen: timestamp }));
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM project_checks WHERE project_id = ?").run(projectId);
    const stmt = db.prepare("INSERT INTO project_checks (id, project_id, command, check_type, source, confidence, last_seen) VALUES (@id, @project_id, @command, @check_type, @source, @confidence, @last_seen)");
    rows.forEach((row) => stmt.run(row));
  });
  tx();
  return rows;
}

export function replaceProjectSignals(db: AppDb, projectId: string, signals: Omit<ProjectSignal, "id" | "project_id" | "timestamp">[]): ProjectSignal[] {
  const timestamp = now();
  const rows = signals.map((signal) => ({ ...signal, id: id(), project_id: projectId, timestamp }));
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM project_signals WHERE project_id = ?").run(projectId);
    const stmt = db.prepare("INSERT INTO project_signals (id, project_id, signal_type, label, description, severity, source, timestamp) VALUES (@id, @project_id, @signal_type, @label, @description, @severity, @source, @timestamp)");
    rows.forEach((row) => stmt.run(row));
  });
  tx();
  return rows;
}

export function getProjectChecks(db: AppDb, projectId: string): ProjectCheck[] {
  return mapRows(db, "SELECT * FROM project_checks WHERE project_id = ? ORDER BY check_type, confidence DESC, command", projectId, toProjectCheck);
}

export function acceptExtraction(db: AppDb, projectId: string, runId: string, sections?: string[]) {
  const draftRow = db.prepare("SELECT * FROM extraction_drafts WHERE project_id = ? AND run_id = ? AND accepted_at IS NULL").get(projectId, runId);
  if (!draftRow) return undefined;
  const draft = toDraft(draftRow as Record<string, unknown>);
  const selected = new Set(sections ?? ["summary", "goals", "decisions", "concepts", "branches", "tasks", "driftWarnings"]);
  const timestamp = now();

  const tx = db.transaction(() => {
    if (selected.has("summary") || selected.has("goals")) {
      const project = getProject(db, projectId);
      const goals = selected.has("goals") && draft.payload.goals?.length ? Array.from(new Set([...(project?.goals ?? []), ...draft.payload.goals])) : project?.goals ?? [];
      const summary = selected.has("summary") && draft.payload.projectSummary ? draft.payload.projectSummary : project?.current_state_summary ?? "";
      db.prepare("UPDATE projects SET current_state_summary = ?, goals = ?, updated_at = ? WHERE id = ?").run(summary, json.stringify(goals), timestamp, projectId);
    }
    if (selected.has("decisions")) draft.payload.decisions.forEach((item) => insertDecision(db, projectId, draft, item));
    if (selected.has("concepts")) draft.payload.concepts.forEach((item) => insertConcept(db, projectId, draft, item));
    if (selected.has("branches")) draft.payload.branches.forEach((item) => insertBranch(db, projectId, draft, item));
    if (selected.has("tasks")) draft.payload.tasks.forEach((item) => insertTask(db, projectId, draft, item));
    if (selected.has("driftWarnings")) draft.payload.driftWarnings.forEach((item) => insertDrift(db, projectId, draft, item));
    db.prepare("UPDATE extraction_drafts SET accepted_at = ? WHERE id = ?").run(timestamp, draft.id);
    db.prepare("UPDATE extraction_runs SET status = 'accepted' WHERE id = ?").run(runId);
  });
  tx();
  return getOverview(db, projectId);
}

export function insertHealthReport(db: AppDb, report: ProjectHealthReport) {
  db.prepare(`
    INSERT INTO project_health_reports (id, project_id, continuity_score, drift_score, unresolved_branch_count, stale_assumption_count, blocked_task_count, contradiction_count, summary, recommendations, timestamp)
    VALUES (@id, @project_id, @continuity_score, @drift_score, @unresolved_branch_count, @stale_assumption_count, @blocked_task_count, @contradiction_count, @summary, @recommendations, @timestamp)
  `).run({ ...report, recommendations: json.stringify(report.recommendations) });
  db.prepare("UPDATE projects SET health_score = ?, updated_at = ? WHERE id = ?").run(report.continuity_score, report.timestamp, report.project_id);
}

function provenance(draft: ExtractionDraft) {
  return { provenance_event_id: draft.event_id, provenance_extraction_run_id: draft.run_id };
}

function insertDecision(db: AppDb, projectId: string, draft: ExtractionDraft, item: ExtractionDraftPayload["decisions"][number]) {
  const record = { ...item, id: id(), project_id: projectId, timestamp: now(), ...provenance(draft) };
  db.prepare(`
    INSERT INTO decision_records VALUES (@id, @project_id, @decision, @rationale, @constraints, @tradeoffs, @alternatives_considered, @failed_paths, @served_goal, @reversal_conditions, @confidence, @source, @timestamp, @provenance_event_id, @provenance_extraction_run_id)
  `).run({
    ...record,
    constraints: json.stringify(record.constraints),
    tradeoffs: json.stringify(record.tradeoffs),
    alternatives_considered: json.stringify(record.alternatives_considered),
    failed_paths: json.stringify(record.failed_paths),
    reversal_conditions: json.stringify(record.reversal_conditions)
  });
}

function insertConcept(db: AppDb, projectId: string, draft: ExtractionDraft, item: ExtractionDraftPayload["concepts"][number]) {
  const record = { ...item, id: id(), project_id: projectId, first_seen: now(), last_seen: now(), ...provenance(draft) };
  db.prepare("INSERT INTO concept_nodes VALUES (@id, @project_id, @concept_name, @description, @weight, @related_concepts, @first_seen, @last_seen, @provenance_event_id, @provenance_extraction_run_id)").run({
    ...record,
    related_concepts: json.stringify(record.related_concepts)
  });
}

function insertBranch(db: AppDb, projectId: string, draft: ExtractionDraft, item: ExtractionDraftPayload["branches"][number]) {
  const record = { ...item, id: id(), project_id: projectId, timestamp: now(), ...provenance(draft) };
  db.prepare("INSERT INTO branch_records VALUES (@id, @project_id, @branch_name, @description, @status, @reason_created, @current_summary, @linked_decisions, @timestamp, @provenance_event_id, @provenance_extraction_run_id)").run({
    ...record,
    linked_decisions: json.stringify(record.linked_decisions)
  });
}

function insertTask(db: AppDb, projectId: string, draft: ExtractionDraft, item: ExtractionDraftPayload["tasks"][number]) {
  const record = { ...item, id: id(), project_id: projectId, created_at: now(), updated_at: now(), ...provenance(draft) };
  db.prepare("INSERT INTO task_records VALUES (@id, @project_id, @task, @status, @priority, @rationale, @linked_decision, @blocker_reason, @created_at, @updated_at, @provenance_event_id, @provenance_extraction_run_id)").run(record);
}

function insertDrift(db: AppDb, projectId: string, draft: ExtractionDraft, item: ExtractionDraftPayload["driftWarnings"][number]) {
  const record = { ...item, id: id(), project_id: projectId, timestamp: now(), ...provenance(draft) };
  db.prepare("INSERT INTO drift_warnings VALUES (@id, @project_id, @drift_type, @description, @severity, @evidence, @suggested_review, @timestamp, @provenance_event_id, @provenance_extraction_run_id)").run({
    ...record,
    evidence: json.stringify(record.evidence)
  });
}

function toEvent(row: Record<string, unknown>): ProjectEvent {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    event_type: String(row.event_type),
    summary: String(row.summary),
    source: String(row.source),
    timestamp: String(row.timestamp),
    related_decision_ids: json.parse(String(row.related_decision_ids ?? "[]"), []),
    related_task_ids: json.parse(String(row.related_task_ids ?? "[]"), [])
  };
}

function toDecision(row: Record<string, unknown>): DecisionRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    decision: String(row.decision),
    rationale: String(row.rationale),
    constraints: json.parse(String(row.constraints ?? "[]"), []),
    tradeoffs: json.parse(String(row.tradeoffs ?? "[]"), []),
    alternatives_considered: json.parse(String(row.alternatives_considered ?? "[]"), []),
    failed_paths: json.parse(String(row.failed_paths ?? "[]"), []),
    served_goal: String(row.served_goal ?? ""),
    reversal_conditions: json.parse(String(row.reversal_conditions ?? "[]"), []),
    confidence: Number(row.confidence ?? 0.5),
    source: String(row.source),
    timestamp: String(row.timestamp),
    provenance_event_id: row.provenance_event_id ? String(row.provenance_event_id) : undefined,
    provenance_extraction_run_id: row.provenance_extraction_run_id ? String(row.provenance_extraction_run_id) : undefined
  };
}

function toConcept(row: Record<string, unknown>): ConceptNode {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    concept_name: String(row.concept_name),
    description: String(row.description),
    weight: Number(row.weight),
    related_concepts: json.parse(String(row.related_concepts ?? "[]"), []),
    first_seen: String(row.first_seen),
    last_seen: String(row.last_seen),
    provenance_event_id: row.provenance_event_id ? String(row.provenance_event_id) : undefined,
    provenance_extraction_run_id: row.provenance_extraction_run_id ? String(row.provenance_extraction_run_id) : undefined
  };
}

function toBranch(row: Record<string, unknown>): BranchRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    branch_name: String(row.branch_name),
    description: String(row.description),
    status: String(row.status) as BranchRecord["status"],
    reason_created: String(row.reason_created),
    current_summary: String(row.current_summary),
    linked_decisions: json.parse(String(row.linked_decisions ?? "[]"), []),
    timestamp: String(row.timestamp),
    provenance_event_id: row.provenance_event_id ? String(row.provenance_event_id) : undefined,
    provenance_extraction_run_id: row.provenance_extraction_run_id ? String(row.provenance_extraction_run_id) : undefined
  };
}

function toTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    task: String(row.task),
    status: String(row.status) as TaskRecord["status"],
    priority: Number(row.priority),
    rationale: String(row.rationale),
    linked_decision: String(row.linked_decision ?? ""),
    blocker_reason: String(row.blocker_reason ?? ""),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    provenance_event_id: row.provenance_event_id ? String(row.provenance_event_id) : undefined,
    provenance_extraction_run_id: row.provenance_extraction_run_id ? String(row.provenance_extraction_run_id) : undefined
  };
}

function toDrift(row: Record<string, unknown>): DriftWarning {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    drift_type: String(row.drift_type),
    description: String(row.description),
    severity: Number(row.severity),
    evidence: json.parse(String(row.evidence ?? "[]"), []),
    suggested_review: String(row.suggested_review),
    timestamp: String(row.timestamp),
    provenance_event_id: row.provenance_event_id ? String(row.provenance_event_id) : undefined,
    provenance_extraction_run_id: row.provenance_extraction_run_id ? String(row.provenance_extraction_run_id) : undefined
  };
}

function toHealth(row: Record<string, unknown>): ProjectHealthReport {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    continuity_score: Number(row.continuity_score),
    drift_score: Number(row.drift_score),
    unresolved_branch_count: Number(row.unresolved_branch_count),
    stale_assumption_count: Number(row.stale_assumption_count),
    blocked_task_count: Number(row.blocked_task_count),
    contradiction_count: Number(row.contradiction_count),
    summary: String(row.summary),
    recommendations: json.parse(String(row.recommendations ?? "[]"), []),
    timestamp: String(row.timestamp)
  };
}

function toDraft(row: Record<string, unknown>): ExtractionDraft {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    project_id: String(row.project_id),
    event_id: String(row.event_id),
    payload: json.parse(String(row.payload), { decisions: [], concepts: [], branches: [], tasks: [], driftWarnings: [] }),
    accepted_at: row.accepted_at ? String(row.accepted_at) : undefined,
    created_at: String(row.created_at)
  };
}

function toFolderSnapshot(row: Record<string, unknown>): FolderSnapshot {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    folder_path: String(row.folder_path),
    source: String(row.source) as FolderSnapshot["source"],
    file_count: Number(row.file_count),
    tracked_extensions: json.parse(String(row.tracked_extensions ?? "[]"), []),
    summary: String(row.summary),
    files: json.parse(String(row.files ?? "[]"), []),
    timestamp: String(row.timestamp)
  };
}

function toProjectCheck(row: Record<string, unknown>): ProjectCheck {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    command: String(row.command),
    check_type: String(row.check_type) as ProjectCheck["check_type"],
    source: String(row.source),
    confidence: Number(row.confidence),
    last_seen: String(row.last_seen)
  };
}

function toProjectSignal(row: Record<string, unknown>): ProjectSignal {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    signal_type: String(row.signal_type) as ProjectSignal["signal_type"],
    label: String(row.label),
    description: String(row.description),
    severity: Number(row.severity),
    source: String(row.source),
    timestamp: String(row.timestamp)
  };
}
