import type {
  BenchmarkProfile,
  ContinuityBudget,
  ContinuityPacket,
  DecisionRecord,
  ProjectOverview,
  RecentChangesSummary,
  RelevantDecisionResult
} from "../../shared/types";
import { now } from "./db";

const budgetLimits: Record<ContinuityBudget, { events: number; decisions: number; branches: number; tasks: number; checks: number; risks: number; chars: number }> = {
  small: { events: 3, decisions: 3, branches: 3, tasks: 3, checks: 3, risks: 3, chars: 900 },
  medium: { events: 6, decisions: 6, branches: 6, tasks: 6, checks: 6, risks: 6, chars: 1800 },
  large: { events: 12, decisions: 12, branches: 12, tasks: 12, checks: 12, risks: 12, chars: 3600 }
};

export const azariContinuityTrial: BenchmarkProfile = {
  id: "azari-continuity-trial",
  name: "Azari Continuity Trial",
  description: "Benchmark profile for testing whether a complex continuity/why-layer project can be tracked without being flattened into tasks.",
  success_criteria: [
    "Detects validation, suite, system sweep, health, or test checks.",
    "Identifies core docs, source entrypoints, and likely why-layer files.",
    "Creates a useful current-state summary.",
    "Creates reviewable drafts instead of auto-accepting extracted decisions.",
    "Flags drift, stale assumptions, missing checks, blocked work, or unresolved branches.",
    "Produces a compact continuity packet suitable for agent handoff."
  ],
  expected_signals: ["documentation", "entrypoint", "why-layer", "stability-risk", "stack"],
  expected_checks: ["test", "validation", "build"]
};

export function createContinuityPacket(overview: ProjectOverview, budget: ContinuityBudget): ContinuityPacket {
  const limits = budgetLimits[budget];
  const risks = [
    ...overview.driftWarnings.map((warning) => ({
      id: warning.id,
      kind: "drift" as const,
      label: warning.drift_type,
      severity: warning.severity,
      source: warning.provenance_event_id ?? warning.provenance_extraction_run_id ?? "drift warning",
      recommendation: warning.suggested_review || warning.description
    })),
    ...overview.signals.filter((signal) => signal.signal_type === "stability-risk").map((signal) => ({
      id: signal.id,
      kind: "signal" as const,
      label: signal.label,
      severity: signal.severity,
      source: signal.source,
      recommendation: signal.description
    }))
  ].sort((a, b) => b.severity - a.severity).slice(0, limits.risks);

  const recent = overview.events.slice(0, limits.events).map(({ id, summary, source, timestamp }) => ({ id, summary: trim(summary, 240), source, timestamp }));
  const decisions = overview.decisions.slice(0, limits.decisions).map(({ id, decision, rationale, confidence, source, timestamp, provenance_event_id }) => ({
    id,
    decision: trim(decision, 180),
    rationale: trim(rationale, 220),
    confidence,
    source,
    timestamp,
    provenance_event_id
  }));
  const branches = overview.branches.filter((branch) => ["active", "unresolved", "paused"].includes(branch.status)).slice(0, limits.branches).map(({ id, branch_name, status, current_summary, timestamp }) => ({
    id,
    branch_name,
    status,
    current_summary: trim(current_summary, 220),
    timestamp
  }));
  const tasks = overview.tasks.filter((task) => ["active", "blocked", "paused"].includes(task.status)).slice(0, limits.tasks).map(({ id, task, status, priority, blocker_reason, updated_at }) => ({
    id,
    task: trim(task, 180),
    status,
    priority,
    blocker_reason: trim(blocker_reason, 180),
    updated_at
  }));
  const checks = overview.checks.slice(0, limits.checks).map(({ id, command, check_type, source, confidence }) => ({ id, command, check_type, source, confidence }));
  const packet: ContinuityPacket = {
    project_id: overview.project.id,
    project_name: overview.project.name,
    budget,
    generated_at: now(),
    summary: trim(summaryFor(overview), limits.chars),
    current_state: trim(overview.project.current_state_summary || overview.project.description || "No accepted project summary yet.", limits.chars),
    recent_changes: recent,
    active_decisions: decisions,
    unresolved_branches: branches,
    active_tasks: tasks,
    detected_checks: checks,
    drift_and_stability_risks: risks,
    recommended_next_review: nextReview(overview, risks),
    provenance: {
      event_count: overview.events.length,
      decision_count: overview.decisions.length,
      folder_snapshot_count: overview.folderSnapshots.length,
      latest_event_timestamp: overview.events[0]?.timestamp,
      latest_snapshot_timestamp: overview.folderSnapshots[0]?.timestamp
    },
    approximate_tokens: 0
  };
  packet.approximate_tokens = estimateTokens(packet);
  return packet;
}

export function recentChanges(overview: ProjectOverview): RecentChangesSummary {
  return {
    project_id: overview.project.id,
    changes: overview.events.slice(0, 12).map(({ id, summary, source, timestamp }) => ({ id, summary, source, timestamp }))
  };
}

export function relevantDecisions(overview: ProjectOverview, topic: string): RelevantDecisionResult {
  const terms = new Set(topic.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? []);
  const decisions = overview.decisions
    .map((decision) => ({ ...decision, relevance_score: scoreDecision(decision, terms) }))
    .filter((decision) => decision.relevance_score > 0 || !terms.size)
    .sort((a, b) => b.relevance_score - a.relevance_score || b.confidence - a.confidence)
    .slice(0, 8);
  return { topic, decisions };
}

function scoreDecision(decision: DecisionRecord, terms: Set<string>) {
  if (!terms.size) return decision.confidence;
  const haystack = [
    decision.decision,
    decision.rationale,
    decision.served_goal,
    decision.constraints.join(" "),
    decision.tradeoffs.join(" "),
    decision.alternatives_considered.join(" "),
    decision.failed_paths.join(" ")
  ].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) if (haystack.includes(term)) score += 1;
  return score + decision.confidence / 10;
}

function summaryFor(overview: ProjectOverview) {
  const health = overview.latestHealthReport?.summary;
  const checkText = overview.checks.length ? `Detected checks: ${overview.checks.slice(0, 4).map((check) => check.command).join(", ")}.` : "No validation checks detected yet.";
  const branchText = overview.branches.filter((branch) => ["active", "unresolved", "paused"].includes(branch.status)).length;
  const riskText = overview.driftWarnings.length + overview.signals.filter((signal) => signal.signal_type === "stability-risk").length;
  return [
    overview.project.current_state_summary || overview.project.description || `${overview.project.name} is tracked but does not yet have an accepted summary.`,
    health,
    `${branchText} unresolved or paused branch(es). ${riskText} drift/stability risk(s).`,
    checkText
  ].filter(Boolean).join(" ");
}

function nextReview(overview: ProjectOverview, risks: ContinuityPacket["drift_and_stability_risks"]) {
  const blocked = overview.tasks.find((task) => task.status === "blocked");
  if (blocked) return `Review blocked task: ${blocked.task}`;
  if (risks[0]) return `Review ${risks[0].kind} risk: ${risks[0].label}`;
  const branch = overview.branches.find((item) => ["active", "unresolved", "paused"].includes(item.status));
  if (branch) return `Clarify branch status: ${branch.branch_name}`;
  const validation = overview.checks.find((check) => ["test", "validation"].includes(check.check_type));
  if (validation) return `Recommended verification command: ${validation.command}`;
  return "Add or refresh project context, then generate a health report.";
}

function trim(value: string | undefined, max: number) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function estimateTokens(packet: ContinuityPacket) {
  return Math.ceil(JSON.stringify({ ...packet, approximate_tokens: 0 }).length / 4);
}
