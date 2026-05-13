import type { ExtractionDraftPayload, ProjectHealthReport, ProjectOverview } from "../../shared/types";
import { id, now } from "./db";

export interface AiAdapter {
  provider: string;
  extractProjectUpdate(input: { projectName: string; note: string; currentSummary: string; goals: string[] }): Promise<ExtractionDraftPayload>;
  generateHealthReport(overview: ProjectOverview): Promise<ProjectHealthReport>;
}

export function createAiAdapter(): AiAdapter {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAiCompatibleAdapter(new HeuristicAdapter());
  }
  return new HeuristicAdapter();
}

class OpenAiCompatibleAdapter implements AiAdapter {
  provider = "openai-compatible";
  constructor(private fallback: AiAdapter) {}

  async extractProjectUpdate(input: { projectName: string; note: string; currentSummary: string; goals: string[] }) {
    return this.fallback.extractProjectUpdate(input);
  }

  async generateHealthReport(overview: ProjectOverview) {
    return this.fallback.generateHealthReport(overview);
  }
}

export class HeuristicAdapter implements AiAdapter {
  provider = "heuristic";

  async extractProjectUpdate(input: { projectName: string; note: string; currentSummary: string; goals: string[] }): Promise<ExtractionDraftPayload> {
    const lines = input.note.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sentences = input.note.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
    const source = `Project update for ${input.projectName}`;
    const goals = extractList(lines, ["goal", "goals", "objective", "purpose"]);
    const decisions = extractList(lines, ["decision", "decided", "choose", "chosen"]).map((text) => ({
      decision: cleanLead(text),
      rationale: findNearby(sentences, text, ["because", "why", "rationale"]) || "Captured from the latest project update.",
      constraints: extractList(lines, ["constraint", "must", "cannot"]),
      tradeoffs: extractList(lines, ["tradeoff", "trade-off", "cost"]),
      alternatives_considered: extractList(lines, ["alternative", "instead of", "considered"]),
      failed_paths: extractList(lines, ["failed", "did not work", "abandoned"]),
      served_goal: goals[0] ?? input.goals[0] ?? "",
      reversal_conditions: extractList(lines, ["revisit", "reverse", "unless", "if this changes"]),
      confidence: 0.72,
      source
    }));
    const tasks = extractList(lines, ["todo", "task", "next", "blocked", "implement", "build", "fix"]).map((text) => ({
      task: cleanLead(text),
      status: /blocked|waiting|stuck/i.test(text) ? "blocked" as const : "active" as const,
      priority: /urgent|first|critical|important/i.test(text) ? 3 : 2,
      rationale: "Execution artifact linked to the latest continuity update.",
      linked_decision: decisions[0]?.decision ?? "",
      blocker_reason: /blocked|waiting|stuck/i.test(text) ? text : "",
      source
    }));
    const branches = extractList(lines, ["branch", "path", "option", "unresolved", "maybe", "could"]).map((text) => ({
      branch_name: titleFrom(text),
      description: cleanLead(text),
      status: /paused/i.test(text) ? "paused" as const : /abandoned/i.test(text) ? "abandoned" as const : "unresolved" as const,
      reason_created: "Mentioned as an open path in the update.",
      current_summary: cleanLead(text),
      linked_decisions: [],
      source
    }));
    const concepts = extractConcepts(input.note).map((concept) => ({
      concept_name: concept,
      description: `Recurring project concept detected in the update: ${concept}.`,
      weight: concept.length > 12 ? 1.4 : 1,
      related_concepts: [],
      source
    }));
    const driftWarnings = detectDraftDrift(input.note, input.currentSummary, branches.length, tasks.filter((task) => task.status === "blocked").length, source);

    return {
      projectSummary: summarize(input.note, input.currentSummary),
      goals,
      decisions,
      concepts,
      branches,
      tasks,
      driftWarnings
    };
  }

  async generateHealthReport(overview: ProjectOverview): Promise<ProjectHealthReport> {
    const unresolved = overview.branches.filter((branch) => ["active", "unresolved", "paused"].includes(branch.status)).length;
    const blocked = overview.tasks.filter((task) => task.status === "blocked").length;
    const stale = overview.decisions.filter((decision) => decision.confidence < 0.55 || decision.reversal_conditions.length > 0).length;
    const contradictions = overview.driftWarnings.filter((warning) => /conflict|contradict|diverge/i.test(warning.drift_type + warning.description)).length;
    const missingChecks = overview.checks.some((check) => ["test", "validation"].includes(check.check_type)) ? 0 : 1;
    const stabilityRisks = overview.signals.filter((signal) => signal.signal_type === "stability-risk").length;
    const driftScore = clamp(20 + unresolved * 8 + blocked * 10 + stale * 6 + contradictions * 12 + missingChecks * 12 + stabilityRisks * 5, 0, 100);
    const continuityScore = clamp(92 - driftScore + Math.min(overview.decisions.length * 3 + overview.events.length * 2, 25), 0, 100);
    const recommendations = [
      unresolved > 0 ? "Review unresolved branches and either merge, pause, or abandon the ones that no longer serve the current project." : "Keep branch state explicit as new paths appear.",
      blocked > 0 ? "Resolve or reframe blocked tasks before adding more execution work." : "Capture new blockers as soon as they appear.",
      stale > 0 ? "Revisit low-confidence decisions or decisions with reversal conditions." : "Continue recording reversal conditions for major decisions.",
      overview.checks.length ? `Suggested verification: ${overview.checks.slice(0, 3).map((check) => check.command).join(", ")}.` : "Add or document at least one test, validation, or health check command."
    ];
    return {
      id: id(),
      project_id: overview.project.id,
      continuity_score: continuityScore,
      drift_score: driftScore,
      unresolved_branch_count: unresolved,
      stale_assumption_count: stale,
      blocked_task_count: blocked,
      contradiction_count: contradictions,
      summary: `${overview.project.name} has ${continuityScore >= 70 ? "solid" : "fragile"} continuity with ${unresolved} unresolved branch(es), ${blocked} blocked task(s), and ${overview.driftWarnings.length} drift warning(s).`,
      recommendations,
      timestamp: now()
    };
  }
}

function extractList(lines: string[], markers: string[]) {
  return lines
    .filter((line) => markers.some((marker) => line.toLowerCase().includes(marker)))
    .map(cleanLead)
    .filter((line, index, all) => line.length > 6 && all.indexOf(line) === index)
    .slice(0, 8);
}

function cleanLead(value: string) {
  return value.replace(/^[-*#\d.)\s]+/, "").replace(/^(goal|decision|task|todo|branch|concept|note)s?:\s*/i, "").trim();
}

function findNearby(sentences: string[], text: string, markers: string[]) {
  const lower = text.toLowerCase();
  return sentences.find((sentence) => sentence.toLowerCase().includes(lower.slice(0, 24)) && markers.some((marker) => sentence.toLowerCase().includes(marker))) ?? "";
}

function titleFrom(text: string) {
  const cleaned = cleanLead(text).replace(/[:.].*$/, "").trim();
  return cleaned.split(/\s+/).slice(0, 6).join(" ") || "Unresolved Branch";
}

function extractConcepts(note: string) {
  const phrases = note.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g) ?? [];
  const ignored = new Set(["The", "This", "User", "Agent", "Project"]);
  return Array.from(new Set(phrases.filter((phrase) => !ignored.has(phrase) && phrase.length > 3))).slice(0, 10);
}

function detectDraftDrift(note: string, currentSummary: string, unresolvedCount: number, blockedCount: number, _source: string) {
  const warnings: ExtractionDraftPayload["driftWarnings"] = [];
  if (/instead|pivot|changed direction|no longer|used to/i.test(note)) {
    warnings.push({
      drift_type: "direction-change",
      description: "The update suggests project direction may have changed and should be reconciled with prior rationale.",
      severity: 3,
      evidence: [firstMatch(note, /(instead|pivot|changed direction|no longer|used to).{0,120}/i)],
      suggested_review: "Confirm whether this is an intentional pivot and record the why-layer."
    });
  }
  if (currentSummary && sharedWordRatio(note, currentSummary) < 0.08 && note.length > 300) {
    warnings.push({
      drift_type: "terminology-shift",
      description: "The new update shares little vocabulary with the existing project summary.",
      severity: 2,
      evidence: ["Low overlap between current summary and latest update."],
      suggested_review: "Check whether the project language has evolved or if this belongs in a separate project."
    });
  }
  if (unresolvedCount >= 3 || blockedCount >= 2) {
    warnings.push({
      drift_type: "execution-pressure",
      description: "The update contains several unresolved paths or blocked tasks.",
      severity: 2,
      evidence: [`${unresolvedCount} unresolved branch cue(s)`, `${blockedCount} blocked task cue(s)`],
      suggested_review: "Convert open paths into explicit branch statuses and choose the next review target."
    });
  }
  return warnings;
}

function summarize(note: string, fallback: string) {
  const compact = note.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > 520 ? `${compact.slice(0, 517)}...` : compact;
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[0].trim() ?? "Drift cue detected in update.";
}

function sharedWordRatio(a: string, b: string) {
  const words = (value: string) => new Set(value.toLowerCase().match(/\b[a-z]{5,}\b/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 1;
  return [...wa].filter((word) => wb.has(word)).length / Math.max(wa.size, wb.size);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
