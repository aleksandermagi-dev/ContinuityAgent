# Agent Setup

Continuity Layer exposes local project memory to humans and AI agents through the local API, CLI, and MCP server.

Start the API first:

```bash
npm run start
```

The API defaults to:

```text
http://127.0.0.1:8787
```

Override it when needed:

```bash
set CONTINUITY_API_URL=http://127.0.0.1:8787
```

## CLI

List projects:

```bash
npm run continuity -- projects
```

Get a continuity packet:

```bash
npm run continuity -- packet --project "Project name" --budget small
```

Get recent changes:

```bash
npm run continuity -- recent --project "Project name"
```

Find decisions by topic:

```bash
npm run continuity -- decisions --project "Project name" --topic "workflow modules"
```

Get detected checks:

```bash
npm run continuity -- checks --project "Project name"
```

Get latest health report:

```bash
npm run continuity -- health --project "Project name"
```

Record an agent update as a draft:

```bash
npm run continuity -- update --project "Project name" --note "Decision: keep writes review-safe." --source codex
```

## MCP

Run the stdio MCP server:

```bash
npm run mcp
```

MCP tools:

- `list_projects`
- `get_context_packet`
- `get_recent_changes`
- `get_relevant_decisions`
- `get_detected_checks`
- `record_project_update`

`record_project_update` creates a pending draft through `/agent-updates`. It never accepts durable memory automatically and never mutates source files.

## Example Agent Prompts

```text
Get a small continuity packet for Azari.
```

```text
Show relevant decisions about workflow modules.
```

```text
Record this update as a draft, don’t accept memory automatically: the desktop app should stay local-first.
```

## Safety Model

- Local-first SQLite-backed project memory.
- Project files are scanned, not silently modified.
- Detected commands are recommended, not auto-run.
- AI or agent writes create reviewable drafts.
- Approved workflow guidance can be used by a human or AI agent to implement changes explicitly.
