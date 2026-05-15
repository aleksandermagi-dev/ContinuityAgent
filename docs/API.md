# API Reference

Base URL during local development:

```text
http://127.0.0.1:8787
```

All write endpoints are local-first. AI-derived memory remains reviewable unless explicitly accepted through the extraction acceptance endpoint.

## Projects

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects` | List projects. |
| `POST` | `/api/projects` | Create a manual project. |
| `GET` | `/api/projects/:id` | Get project metadata. |
| `GET` | `/api/projects/:id/overview` | Get project state, events, drafts, snapshots, checks, and signals. |

Create project body:

```json
{
  "name": "Project name",
  "description": "Optional description",
  "category": "software",
  "tags": ["demo"]
}
```

## Intake And Drafts

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/:id/updates` | Add a manual update and create an advisory extraction draft. |
| `POST` | `/api/projects/:id/agent-updates` | Agent/client update; creates a draft and requires review. |
| `POST` | `/api/projects/:id/extractions/:runId/accept` | Accept selected draft sections into durable memory. |

Agent update body:

```json
{
  "note": "Decision: keep writes review-safe because durable memory needs approval.",
  "source": "azari-plugin-prototype"
}
```

## File And Folder Import

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/from-file` | Create a project from a selected file. |
| `POST` | `/api/projects/:id/folder-snapshots` | Add a folder snapshot to an existing project. |
| `POST` | `/api/project-discovery/scan` | Scan a parent folder or browser-selected folder for project candidates. |
| `POST` | `/api/project-discovery/track` | Create a tracked project from a candidate. |

Discovery scan by local path:

```json
{
  "rootPath": "C:\\Users\\you\\Projects"
}
```

Discovery scan by browser selection:

```json
{
  "folderName": "Selected folder",
  "files": [
    {
      "path": "Example/README.md",
      "size": 1200,
      "text": "# Example"
    }
  ]
}
```

Discovery scan responses include candidates plus advisory metadata:

```json
{
  "candidates": [
    {
      "name": "Example App",
      "detection_reasons": ["README found", "package.json scripts", "validation command"],
      "confidence": 0.75
    }
  ],
  "warnings": [
    {
      "code": "generated-folders-skipped",
      "severity": "info",
      "message": "Skipped generated/cache folders during discovery."
    }
  ],
  "ignored_folder_count": 1,
  "unreadable_file_count": 0,
  "scanned_at": "2026-05-14T00:00:00.000Z"
}
```

Warnings are advisory. Users can still track candidates after reviewing evidence.

## Health, Checks, And Reports

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/health` | Get latest health report. |
| `POST` | `/api/projects/:id/reports/health` | Generate a new health report. |
| `GET` | `/api/projects/:id/checks` | Get detected checks. |
| `GET` | `/api/projects/:id/export?format=markdown` | Export a Markdown report. |
| `GET` | `/api/projects/:id/export?format=json` | Export full JSON overview. |

Detected checks are recommendations only. The app does not run discovered commands automatically.

## Continuity Packets

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:id/context-packet?budget=small` | Compact packet for quick handoff. |
| `GET` | `/api/projects/:id/context-packet?budget=medium` | Balanced packet. |
| `GET` | `/api/projects/:id/context-packet?budget=large` | More detailed packet. |
| `GET` | `/api/projects/:id/decisions/relevant?topic=...` | Topic-scored decision lookup. |
| `GET` | `/api/projects/:id/recent-changes` | Recent timeline changes. |

Continuity packets include project state, recent changes, active decisions, unresolved branches, active tasks, detected checks, drift/stability risks, next review recommendation, and provenance counts.

## CLI And MCP Agent Access

The CLI and MCP server use the local HTTP API. Start the API first with `npm run start` or `npm run dev`.

CLI commands:

```bash
npm run continuity -- projects
npm run continuity -- packet --project "Project name" --budget small
npm run continuity -- recent --project "Project name"
npm run continuity -- decisions --project "Project name" --topic "workflow modules"
npm run continuity -- checks --project "Project name"
npm run continuity -- health --project "Project name"
npm run continuity -- update --project "Project name" --note "Update text" --source codex
```

The API URL defaults to `http://127.0.0.1:8787`. Override it with `CONTINUITY_API_URL`.

MCP stdio server:

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

`record_project_update` calls `/agent-updates`, creates a pending draft, and never accepts durable memory automatically. No CLI or MCP command mutates imported project files.

## Workflow Modules

Workflow modules are shared continuity-aware workflows, not separate agents. They use project state and local/user-provided context, create suggested outputs, and require review before durable continuity records are added. After acceptance, the output becomes reviewed implementation guidance that a human or AI agent can use to apply fixes explicitly.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/workflows/modules` | List built-in workflow module definitions. |
| `POST` | `/api/projects/:id/workflows/:moduleId/run` | Run a workflow module and create suggested guidance for review. |
| `GET` | `/api/projects/:id/workflows/runs` | List workflow runs for a project. |
| `POST` | `/api/projects/:id/workflows/runs/:runId/accept` | Accept a draft workflow output into continuity records. |
| `POST` | `/api/projects/:id/workflows/runs/:runId/reject` | Reject a draft workflow output and preserve the reason. |

Built-in module ids:

- `pr-reviewer`
- `doc-writer`
- `refactor-tracker`

Run PR Reviewer:

```json
{
  "patch": "+ const value = eval(userInput);"
}
```

Run Doc Writer:

```json
{
  "changeNotes": "Added GET /api/workflows/modules and workflow run endpoints."
}
```

Run Refactor Tracker:

```json
{}
```

Refactor Tracker uses the project's accepted folder snapshots. If no snapshot exists, the endpoint returns a clear missing-context error.

Workflow acceptance creates normal continuity records such as events, unresolved branch suggestions, drift warnings, and reviewed implementation guidance. It does not mutate imported project files; applying a patch or fix remains a separate explicit action by a human or AI agent.

## Benchmarks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/benchmarks/azari-continuity-trial` | Get the synthetic Azari-style benchmark profile. |

Azari is a benchmark/customer pattern, not a dependency or product identity.
