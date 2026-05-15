# Continuity Layer

A local-first project continuity and coherence layer for long-running, evolving work.

Continuity Layer tracks not just what changed, but why it changed: decisions, branches, checks, drift risks, project health, and compact continuity packets for people or agents who need to resume work without rereading an entire project history.

## What This Is

- A standalone local web app and API service.
- A SQLite-backed memory/coherence layer for complex projects.
- A project discovery tool that can scan folders, detect checks, and create reviewable project memory drafts.
- A continuity-aware workflow substrate for developer workflows like PR review, documentation review, and refactor tracking.
- A universal helper for software builds, research, writing/worldbuilding, startups, and other evolving systems.
- A future-friendly bridge for assistants such as Azari to request compact, sourced project context.

## What This Is Not

- Not Azari, and not merged with Azari.
- Not a generic chatbot.
- Not only a task manager.
- Not a tool that silently mutates project files.
- Not ten separate agents with duplicated memory.
- Not a command runner for discovered checks yet; it recommends checks but does not execute them.

## Early Access

Continuity Layer is being prepared for **$19 paid early access** for AI builders, plus an optional **$99 setup session** for buyers who want help connecting a real project and AI workflow.

Launch line:

```text
Stop re-explaining your project to AI.
```

Buyer-facing launch material:

- [Static launch page](site/index.html)
- [Launch notes](docs/LAUNCH.md)
- [Agent setup](docs/AGENT_SETUP.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Outreach plan](docs/OUTREACH.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Product page copy](docs/PRODUCT_PAGE_COPY.md)

Payment is handled through the external Lemon Squeezy checkout linked from the launch page. Setup-session requests and beta feedback currently go through the Tally form. There is no in-app billing, license enforcement, hosted account system, or automatic patch application in this release.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5173
```

The API runs at:

```text
http://127.0.0.1:8787
```

The development SQLite database is stored at `data/project-continuity.sqlite` unless `PCA_DB_PATH` is set.

## Verification

```bash
npm run verify
```

This runs:

- `npm test`
- `npm run build`

When the dev server is already running, use:

```bash
npm run smoke
```

The smoke check verifies the API and frontend URLs respond.

## Desktop App (Tauri)

Continuity Layer is being prepared as a lightweight Tauri desktop app so local project tracking can use native folder selection and avoid browser upload limits.

Desktop scripts:

```bash
npm run tauri:dev
npm run tauri:build
npm run package:win
```

Tauri requires the Rust toolchain, Microsoft C++ Build Tools, and WebView2 on Windows. The desktop app stores its SQLite database in the Tauri app data directory, while browser/dev mode continues to use the existing Express API and `data/project-continuity.sqlite`.

The desktop path keeps the same React UI. In Tauri mode, `Add Project Folder` opens a native directory picker and scans the real local path through Rust commands. In browser mode, the same button falls back to browser-safe folder selection.

## Demo Workflow

1. Start the app with `npm run dev`.
2. Use `Add Project Folder` for whole-project tracking, `Add Single File` for a README/doc/config file, or `Scan path` for a pasted local path.
3. Track a project candidate.
4. Review the generated draft before accepting decisions/tasks/branches.
5. Generate a Project Health report.
6. Open Reports and export Markdown, JSON, or continuity packets.

Project discovery shows why each candidate was found and warns when generated/cache folders were skipped or when confidence is low. Temporary screenshot folders such as `pics/` are local debugging evidence only and are ignored by git.

## Workflow Modules

Continuity Layer includes lightweight workflow modules that run on top of the same continuity spine: shared project state, provenance, drift tracking, drafts, and human approval.

The first modules are:

- `PR Reviewer`: reviews supplied patch/diff text for bugs, missing tests, security concerns, and maintainability risks.
- `Doc Writer`: checks whether code or API changes need README/docs/docstring updates and drafts documentation notes.
- `Refactor Tracker`: reviews tracked folder snapshots for TODO/FIXME markers, large files, duplicate-looking patterns, and maintainability risks.

These are not separate agents. They do not maintain their own memory, call external services, run discovered commands, or mutate project files. Each run produces suggested guidance first: review comments, documentation drafts, refactor recommendations, or proposed patch text. After a human or AI reviewer approves the run, Continuity Layer records it as implementation guidance with provenance. Humans or AI agents can then use that approved guidance to implement fixes explicitly.

## For AI Agents

Continuity Layer is designed to help humans and AI agents stop re-explaining the same project over and over. It provides shared continuity memory for current state, recent changes, relevant decisions, detected checks, drift risks, and review-safe updates.

Start the local API first:

```bash
npm run start
```

Then agents or humans can use the CLI:

```bash
npm run continuity -- projects
npm run continuity -- packet --project "Azari" --budget small
npm run continuity -- decisions --project "Azari" --topic "workflow modules"
npm run continuity -- update --project "Azari" --note "Decision: keep agent writes review-safe." --source codex
```

The update command calls `/agent-updates`, so it creates a pending draft only. It does not accept memory or change project files.

For MCP-compatible assistants, run the stdio server:

```bash
npm run mcp
```

Available MCP tools:

- `list_projects`
- `get_context_packet`
- `get_recent_changes`
- `get_relevant_decisions`
- `get_detected_checks`
- `record_project_update`

Example agent prompts:

- “Get a small packet for Azari.”
- “Record this update as a draft.”
- “Show relevant decisions about workflow modules.”

## Azari Continuity Trial

Azari is used only as a representative stress-test pattern. The fixture at `fixtures/azari-continuity-trial` is synthetic and contains no private Azari code or data.

Use it to confirm the system can detect:

- validation/suite/system sweep checks
- docs and why-layer notes
- unresolved branches
- drift/stability risks
- compact continuity packets for agent handoff

Scan the fixture from the UI or call the discovery endpoint with its path.

## API Overview

See [docs/API.md](docs/API.md) for endpoint details.

High-value endpoints:

- `POST /api/project-discovery/scan`
- `POST /api/project-discovery/track`
- `GET /api/projects/:id/context-packet?budget=small|medium|large`
- `POST /api/projects/:id/agent-updates`
- `GET /api/workflows/modules`
- `POST /api/projects/:id/workflows/:moduleId/run`
- `GET /api/benchmarks/azari-continuity-trial`

## Optional AI Provider

Set `OPENAI_API_KEY` to enable the OpenAI-compatible adapter. Without it, the app uses deterministic extraction and report heuristics so the demo workflow still works locally.
