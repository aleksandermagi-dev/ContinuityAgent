import type {
  FolderSnapshotFile,
  ProjectOverview,
  WorkflowFinding,
  WorkflowModuleDefinition,
  WorkflowOutput
} from "../../shared/types";

export const workflowModules: WorkflowModuleDefinition[] = [
  {
    id: "pr-reviewer",
    name: "PR Reviewer",
    purpose: "Review a provided diff or patch for bugs, missing tests, security concerns, regressions, and maintainability issues.",
    trigger_type: "patch",
    required_context: ["patch"],
    output_type: "review-report",
    risk_level: "medium",
    review_required: true
  },
  {
    id: "doc-writer",
    name: "Doc Writer",
    purpose: "Detect whether changes need README, docs, or docstring updates and draft documentation changes for review.",
    trigger_type: "change-notes",
    required_context: ["patch or changeNotes"],
    output_type: "documentation-draft",
    risk_level: "low",
    review_required: true
  },
  {
    id: "refactor-tracker",
    name: "Refactor Tracker",
    purpose: "Inspect tracked project snapshots for TODO/FIXME markers, large files, duplicate-looking patterns, and maintainability risks.",
    trigger_type: "project-snapshot",
    required_context: ["folder snapshot"],
    output_type: "refactor-report",
    risk_level: "medium",
    review_required: true
  }
];

export interface WorkflowRunInput {
  patch?: string;
  changeNotes?: string;
  context?: string;
}

export function getWorkflowModules() {
  return workflowModules.map((module) => ({ ...module, review_required: module.review_required ?? true }));
}

export function getWorkflowModule(moduleId: string) {
  return getWorkflowModules().find((module) => module.id === moduleId);
}

export function runWorkflowModule(moduleId: string, overview: ProjectOverview, input: WorkflowRunInput): WorkflowOutput {
  if (moduleId === "pr-reviewer") return runPrReviewer(input);
  if (moduleId === "doc-writer") return runDocWriter(input);
  if (moduleId === "refactor-tracker") return runRefactorTracker(overview);
  throw new Error(`Unknown workflow module: ${moduleId}`);
}

export function workflowInputSummary(moduleId: string, input: WorkflowRunInput) {
  const text = [input.patch, input.changeNotes, input.context].filter(Boolean).join("\n").trim();
  if (text) return `${moduleId} reviewed ${text.length} characters of supplied context.`;
  return `${moduleId} reviewed tracked project context.`;
}

function runPrReviewer(input: WorkflowRunInput): WorkflowOutput {
  const patch = (input.patch ?? input.context ?? "").trim();
  requireContext(patch, "PR Reviewer requires patch or diff text.");
  const findings: WorkflowFinding[] = [];
  const lower = patch.toLowerCase();

  if (/\beval\s*\(|innerhtml|child_process|exec\s*\(/i.test(patch)) {
    findings.push(finding(
      "Potential unsafe execution or injection surface",
      "security",
      3,
      "The patch appears to introduce dynamic execution, shell execution, or raw HTML assignment.",
      evidenceLines(patch, /(eval\s*\(|innerHTML|child_process|exec\s*\()/i),
      "Review the trust boundary, sanitize inputs, and prefer safer APIs before accepting the change."
    ));
  }
  if (/^\+/.test(patch) && !/(test|spec|vitest|jest|pytest|assert|expect\()/i.test(patch)) {
    findings.push(finding(
      "Code change has no visible test coverage",
      "missing-tests",
      2,
      "The provided patch adds behavior but does not include obvious test files or assertions.",
      ["Patch contains added lines but no test/spec/assertion indicators."],
      "Add or update focused tests for the behavior changed by this patch."
    ));
  }
  if (/TODO|FIXME/i.test(patch)) {
    findings.push(finding(
      "Patch introduces unresolved maintenance markers",
      "maintainability",
      2,
      "TODO/FIXME markers can become unresolved branches if they are not tracked explicitly.",
      evidenceLines(patch, /(TODO|FIXME)/i),
      "Convert the marker into a tracked follow-up or resolve it before merge."
    ));
  }
  if (/catch\s*\([^)]*\)\s*\{\s*\}/i.test(patch) || /console\.log/i.test(patch)) {
    findings.push(finding(
      "Debug or swallowed-error pattern detected",
      "style",
      1,
      "The patch may swallow errors or leave debugging output in a production path.",
      evidenceLines(patch, /(catch\s*\([^)]*\)\s*\{\s*\}|console\.log)/i),
      "Replace with explicit error handling or project-standard logging."
    ));
  }
  if (!findings.length) {
    findings.push(finding(
      "No obvious blocker found in supplied patch",
      "maintainability",
      1,
      "The heuristic reviewer did not detect high-risk patterns in the supplied context.",
      ["Heuristic pass completed against the provided patch text."],
      "Still run the detected project checks and review domain-specific behavior."
    ));
  }

  return output("PR review completed as an advisory workflow draft.", findings, "Workflow PR review recorded for human review.");
}

function runDocWriter(input: WorkflowRunInput): WorkflowOutput {
  const context = [input.patch, input.changeNotes, input.context].filter(Boolean).join("\n").trim();
  requireContext(context, "Doc Writer requires patch text, change notes, or supplied context.");
  const docsChanged = /(README|docs\/|\.md|docstring|documentation)/i.test(context);
  const likelyPublicChange = /(api\/|route|endpoint|export function|interface |type |config|env|command|script)/i.test(context);
  const findings: WorkflowFinding[] = [];

  if (likelyPublicChange && !docsChanged) {
    findings.push(finding(
      "Public behavior changed without visible documentation update",
      "docs",
      2,
      "The change context suggests API, configuration, command, or exported type changes, but no docs update was provided.",
      evidenceLines(context, /(api\/|route|endpoint|export function|interface |type |config|env|command|script)/i),
      "Draft README/API documentation before accepting the workflow recommendation."
    ));
  } else {
    findings.push(finding(
      "Documentation impact reviewed",
      "docs",
      1,
      docsChanged ? "The supplied context already references docs changes." : "No strong documentation drift signal was detected.",
      ["Doc Writer reviewed the supplied change context."],
      docsChanged ? "Review the proposed docs for accuracy." : "No docs action is required unless the user-facing behavior changed."
    ));
  }

  const proposed = [
    "Proposed documentation draft:",
    "- Explain what changed and why it matters to project continuity.",
    "- Add any new command, endpoint, configuration, or workflow input.",
    "- Note review/approval requirements if the change affects durable project memory."
  ].join("\n");

  return {
    ...output("Documentation impact reviewed as an advisory draft.", findings, "Workflow documentation review recorded for human review."),
    proposed_patches: [proposed]
  };
}

function runRefactorTracker(overview: ProjectOverview): WorkflowOutput {
  const files = overview.folderSnapshots.flatMap((snapshot) => snapshot.files);
  requireContext(files.length ? "snapshot" : "", "Refactor Tracker requires at least one folder snapshot.");
  const findings: WorkflowFinding[] = [];
  const todoFiles = files.filter((file) => /TODO|FIXME/i.test(file.excerpt ?? ""));
  const largeFiles = files.filter((file) => file.kind === "text" && file.size > 15_000);
  const duplicateSignals = duplicateLookingLines(files);

  todoFiles.slice(0, 5).forEach((file) => {
    findings.push(finding(
      `Unresolved marker in ${file.path}`,
      "refactor",
      2,
      "TODO/FIXME markers should become tracked branches or explicit tasks so they do not vanish from project continuity.",
      evidenceLines(file.excerpt ?? "", /(TODO|FIXME)/i).map((line) => `${file.path}: ${line}`),
      "Review whether this should become an accepted branch or task."
    ));
  });
  largeFiles.slice(0, 5).forEach((file) => {
    findings.push(finding(
      `Large file may need ownership review: ${file.path}`,
      "maintainability",
      2,
      "Large files can hide multiple responsibilities and make future continuity harder to preserve.",
      [`${file.path} is ${file.size} bytes.`],
      "Check whether this file should be split or documented with clearer responsibility boundaries."
    ));
  });
  duplicateSignals.slice(0, 5).forEach((line) => {
    findings.push(finding(
      "Duplicate-looking logic signal",
      "refactor",
      1,
      "A repeated line pattern appears across tracked excerpts.",
      [line],
      "Review whether the repeated pattern represents intentional symmetry or extractable shared logic."
    ));
  });
  if (!findings.length) {
    findings.push(finding(
      "No immediate refactor hotspot found",
      "maintainability",
      1,
      "The tracked snapshots did not show TODO/FIXME markers, large text files, or simple duplicate-looking patterns.",
      ["Refactor Tracker reviewed tracked folder snapshot excerpts."],
      "Keep running this workflow after larger scans or major architecture changes."
    ));
  }

  return output("Refactor tracking completed against the current project snapshot.", findings, "Workflow refactor tracking recorded for human review.");
}

function output(summary: string, findings: WorkflowFinding[], eventSummary: string): WorkflowOutput {
  return {
    summary,
    findings,
    draft_comments: findings.map((item) => `[${item.category}] ${item.title}: ${item.recommendation}`),
    proposed_patches: [],
    continuity_updates: {
      event_summary: eventSummary,
      branch_suggestions: findings.filter((item) => item.severity >= 2).map((item) => item.title),
      drift_warnings: findings
        .filter((item) => ["docs", "drift", "maintainability", "refactor", "missing-tests"].includes(item.category))
        .map((item) => ({
          drift_type: `workflow-${item.category}`,
          description: item.description,
          severity: item.severity,
          evidence: item.evidence,
          suggested_review: item.recommendation
        }))
    }
  };
}

function finding(
  title: string,
  category: WorkflowFinding["category"],
  severity: number,
  description: string,
  evidence: string[],
  recommendation: string
): WorkflowFinding {
  return { title, category, severity, description, evidence, recommendation };
}

function evidenceLines(text: string, pattern: RegExp) {
  return text
    .split(/\r?\n/)
    .filter((line) => pattern.test(line))
    .slice(0, 5)
    .map((line) => line.trim().slice(0, 220));
}

function duplicateLookingLines(files: FolderSnapshotFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const line of (file.excerpt ?? "").split(/\r?\n/)) {
      const normalized = line.trim();
      if (normalized.length < 35 || normalized.startsWith("//") || normalized.startsWith("#")) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([line, count]) => `${count} repeats: ${line.slice(0, 180)}`);
}

function requireContext(value: string, message: string) {
  if (!value.trim()) throw new Error(message);
}
