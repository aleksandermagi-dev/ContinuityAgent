export type ProjectStatus = "active" | "paused" | "complete" | "abandoned";
export type BranchStatus = "active" | "unresolved" | "abandoned" | "merged" | "paused";
export type TaskStatus = "active" | "paused" | "blocked" | "complete" | "abandoned";

export interface Project {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  goals: string[];
  current_state_summary: string;
  health_score: number;
  tags: string[];
}

export interface ProjectEvent {
  id: string;
  project_id: string;
  event_type: string;
  summary: string;
  source: string;
  timestamp: string;
  related_decision_ids: string[];
  related_task_ids: string[];
}

export interface DecisionRecord {
  id: string;
  project_id: string;
  decision: string;
  rationale: string;
  constraints: string[];
  tradeoffs: string[];
  alternatives_considered: string[];
  failed_paths: string[];
  served_goal: string;
  reversal_conditions: string[];
  confidence: number;
  source: string;
  timestamp: string;
  provenance_event_id?: string;
  provenance_extraction_run_id?: string;
}

export interface ConceptNode {
  id: string;
  project_id: string;
  concept_name: string;
  description: string;
  weight: number;
  related_concepts: string[];
  first_seen: string;
  last_seen: string;
  provenance_event_id?: string;
  provenance_extraction_run_id?: string;
}

export interface BranchRecord {
  id: string;
  project_id: string;
  branch_name: string;
  description: string;
  status: BranchStatus;
  reason_created: string;
  current_summary: string;
  linked_decisions: string[];
  timestamp: string;
  provenance_event_id?: string;
  provenance_extraction_run_id?: string;
}

export interface TaskRecord {
  id: string;
  project_id: string;
  task: string;
  status: TaskStatus;
  priority: number;
  rationale: string;
  linked_decision: string;
  blocker_reason: string;
  created_at: string;
  updated_at: string;
  provenance_event_id?: string;
  provenance_extraction_run_id?: string;
}

export interface DriftWarning {
  id: string;
  project_id: string;
  drift_type: string;
  description: string;
  severity: number;
  evidence: string[];
  suggested_review: string;
  timestamp: string;
  provenance_event_id?: string;
  provenance_extraction_run_id?: string;
}

export interface ProjectHealthReport {
  id: string;
  project_id: string;
  continuity_score: number;
  drift_score: number;
  unresolved_branch_count: number;
  stale_assumption_count: number;
  blocked_task_count: number;
  contradiction_count: number;
  summary: string;
  recommendations: string[];
  timestamp: string;
}

export interface FolderSnapshotFile {
  path: string;
  size: number;
  kind: "text" | "binary" | "skipped";
  excerpt?: string;
}

export interface FolderSnapshot {
  id: string;
  project_id: string;
  folder_path: string;
  source: "browser-selection" | "local-path";
  file_count: number;
  tracked_extensions: string[];
  summary: string;
  files: FolderSnapshotFile[];
  timestamp: string;
}

export interface FileSnapshot {
  file_name: string;
  file_path: string;
  parent_folder_name: string;
  size: number;
  kind: "text" | "binary" | "skipped";
  excerpt?: string;
}

export interface ProjectCheck {
  id: string;
  project_id: string;
  command: string;
  check_type: "test" | "build" | "lint" | "typecheck" | "validation" | "run" | "unknown";
  source: string;
  confidence: number;
  last_seen: string;
}

export interface ProjectSignal {
  id: string;
  project_id: string;
  signal_type: "documentation" | "entrypoint" | "architecture" | "why-layer" | "stability-risk" | "stack";
  label: string;
  description: string;
  severity: number;
  source: string;
  timestamp: string;
}

export interface ProjectCandidate {
  id: string;
  name: string;
  path: string;
  evidence_files: string[];
  readme_preview: string;
  detected_stack: string[];
  detected_checks: Omit<ProjectCheck, "id" | "project_id" | "last_seen">[];
  signals: Omit<ProjectSignal, "id" | "project_id" | "timestamp">[];
  confidence: number;
  files: FolderSnapshotFile[];
  source: "browser-selection" | "local-path";
}

export interface ProjectImportResult {
  project: Project;
  snapshot: FolderSnapshot;
  draft: ExtractionDraft;
  checks: ProjectCheck[];
  signals: ProjectSignal[];
}

export type ContinuityBudget = "small" | "medium" | "large";

export interface ContinuityPacket {
  project_id: string;
  project_name: string;
  budget: ContinuityBudget;
  generated_at: string;
  summary: string;
  current_state: string;
  recent_changes: Pick<ProjectEvent, "id" | "summary" | "source" | "timestamp">[];
  active_decisions: Pick<DecisionRecord, "id" | "decision" | "rationale" | "confidence" | "source" | "timestamp" | "provenance_event_id">[];
  unresolved_branches: Pick<BranchRecord, "id" | "branch_name" | "status" | "current_summary" | "timestamp">[];
  active_tasks: Pick<TaskRecord, "id" | "task" | "status" | "priority" | "blocker_reason" | "updated_at">[];
  detected_checks: Pick<ProjectCheck, "id" | "command" | "check_type" | "source" | "confidence">[];
  drift_and_stability_risks: Array<{
    id: string;
    kind: "drift" | "signal";
    label: string;
    severity: number;
    source: string;
    recommendation: string;
  }>;
  recommended_next_review: string;
  provenance: {
    event_count: number;
    decision_count: number;
    folder_snapshot_count: number;
    latest_event_timestamp?: string;
    latest_snapshot_timestamp?: string;
  };
  approximate_tokens: number;
}

export interface RecentChangesSummary {
  project_id: string;
  changes: Pick<ProjectEvent, "id" | "summary" | "source" | "timestamp">[];
}

export interface RelevantDecisionResult {
  topic: string;
  decisions: Array<DecisionRecord & { relevance_score: number }>;
}

export interface BenchmarkProfile {
  id: string;
  name: string;
  description: string;
  success_criteria: string[];
  expected_signals: string[];
  expected_checks: string[];
}

export interface ExtractionDraftPayload {
  projectSummary?: string;
  goals?: string[];
  decisions: Omit<DecisionRecord, "id" | "project_id" | "timestamp">[];
  concepts: Omit<ConceptNode, "id" | "project_id" | "first_seen" | "last_seen">[];
  branches: Omit<BranchRecord, "id" | "project_id" | "timestamp">[];
  tasks: Omit<TaskRecord, "id" | "project_id" | "created_at" | "updated_at">[];
  driftWarnings: Omit<DriftWarning, "id" | "project_id" | "timestamp">[];
}

export interface ExtractionRun {
  id: string;
  project_id: string;
  event_id: string;
  status: "draft" | "accepted";
  provider: string;
  created_at: string;
}

export interface ExtractionDraft {
  id: string;
  run_id: string;
  project_id: string;
  event_id: string;
  payload: ExtractionDraftPayload;
  accepted_at?: string;
  created_at: string;
}

export interface ProjectOverview {
  project: Project;
  events: ProjectEvent[];
  decisions: DecisionRecord[];
  concepts: ConceptNode[];
  branches: BranchRecord[];
  tasks: TaskRecord[];
  driftWarnings: DriftWarning[];
  latestHealthReport?: ProjectHealthReport;
  pendingDrafts: ExtractionDraft[];
  folderSnapshots: FolderSnapshot[];
  checks: ProjectCheck[];
  signals: ProjectSignal[];
}
