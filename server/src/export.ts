import type { ProjectOverview } from "../../shared/types";

export function toMarkdown(overview: ProjectOverview) {
  const { project } = overview;
  return [
    `# ${project.name}`,
    "",
    `Status: ${project.status}`,
    `Category: ${project.category}`,
    `Health Score: ${project.health_score}`,
    "",
    "## Current State",
    project.current_state_summary || "_No current state summary accepted yet._",
    "",
    "## Goals",
    list(project.goals),
    "",
    "## Decisions / Why",
    overview.decisions.map((item) => `- ${item.decision} — ${item.rationale}`).join("\n") || "_No accepted decisions yet._",
    "",
    "## Branches",
    overview.branches.map((item) => `- [${item.status}] ${item.branch_name}: ${item.current_summary}`).join("\n") || "_No accepted branches yet._",
    "",
    "## Tasks",
    overview.tasks.map((item) => `- [${item.status}] ${item.task}`).join("\n") || "_No accepted tasks yet._",
    "",
    "## Drift / Contradictions",
    overview.driftWarnings.map((item) => `- Severity ${item.severity}: ${item.description}`).join("\n") || "_No accepted drift warnings yet._",
    "",
    "## Folder Snapshots",
    overview.folderSnapshots.map((item) => `- ${item.timestamp}: ${item.folder_path} (${item.file_count} files, ${item.source})`).join("\n") || "_No folder snapshots yet._",
    "",
    "## Detected Checks",
    overview.checks.map((item) => `- [${item.check_type}] ${item.command} (${item.source})`).join("\n") || "_No detected checks yet._",
    "",
    "## Project Signals",
    overview.signals.map((item) => `- [${item.signal_type}] ${item.label}: ${item.description}`).join("\n") || "_No project signals yet._",
    "",
    "## Workflow Runs",
    overview.workflowRuns.map((item) => `- [${item.status}] ${item.module_id}: ${item.output.summary}`).join("\n") || "_No workflow runs yet._",
    "",
    "## Latest Health Report",
    overview.latestHealthReport
      ? `${overview.latestHealthReport.summary}\n\n${list(overview.latestHealthReport.recommendations)}`
      : "_No health report generated yet._",
    "",
    "## Timeline",
    overview.events.map((event) => `- ${event.timestamp}: ${event.summary}`).join("\n") || "_No events yet._"
  ].join("\n");
}

function list(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "_None recorded._";
}
