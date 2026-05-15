#!/usr/bin/env node
import {
  compactJson,
  getContextPacket,
  getDetectedChecks,
  getHealthReport,
  getRecentChanges,
  getRelevantDecisions,
  listProjects,
  recordProjectUpdate
} from "./continuity-api.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function help() {
  return [
    "Continuity Layer CLI",
    "",
    "Usage:",
    "  continuity projects",
    "  continuity packet --project <id-or-name> --budget small|medium|large",
    "  continuity recent --project <id-or-name>",
    "  continuity decisions --project <id-or-name> --topic <text>",
    "  continuity checks --project <id-or-name>",
    "  continuity health --project <id-or-name>",
    "  continuity update --project <id-or-name> --note <text> --source <agent-name>",
    "",
    "Environment:",
    "  CONTINUITY_API_URL=http://127.0.0.1:8787"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "help";
  let output;

  if (command === "help" || args.help) {
    console.log(help());
    return;
  }
  if (command === "projects") output = await listProjects();
  else if (command === "packet") output = await getContextPacket(args.project, args.budget ?? "medium");
  else if (command === "recent") output = await getRecentChanges(args.project);
  else if (command === "decisions") output = await getRelevantDecisions(args.project, args.topic ?? "");
  else if (command === "checks") output = await getDetectedChecks(args.project);
  else if (command === "health") output = await getHealthReport(args.project);
  else if (command === "update") output = await recordProjectUpdate(args.project, args.note, args.source ?? "agent-cli");
  else throw new Error(`Unknown command: ${command}`);

  console.log(compactJson(output));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
