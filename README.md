# Project Continuity Agent

A local-first project continuity and coherence layer for long-running, evolving work.

Project Continuity Agent tracks not just what changed, but why it changed: decisions, branches, checks, drift risks, project health, and compact continuity packets for people or agents who need to resume work without rereading an entire project history.

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

## Demo Workflow

1. Start the app with `npm run dev`.
2. Use `Add File` with a README/doc/config file, or use `Scan selected folder` / `Scan path`.
3. Track a project candidate.
4. Review the generated draft before accepting decisions/tasks/branches.
5. Generate a Project Health report.
6. Open Reports and export Markdown, JSON, or continuity packets.

Project discovery shows why each candidate was found and warns when generated/cache folders were skipped or when confidence is low. Temporary screenshot folders such as `pics/` are local debugging evidence only and are ignored by git.

## Workflow Modules

ContinuityAgent includes lightweight workflow modules that run on top of the same continuity spine: shared project state, provenance, drift tracking, drafts, and human approval.

The first modules are:

- `PR Reviewer`: reviews supplied patch/diff text for bugs, missing tests, security concerns, and maintainability risks.
- `Doc Writer`: checks whether code or API changes need README/docs/docstring updates and drafts documentation notes.
- `Refactor Tracker`: reviews tracked folder snapshots for TODO/FIXME markers, large files, duplicate-looking patterns, and maintainability risks.

These are not separate agents. They do not maintain their own memory, call external services, run discovered commands, or mutate project files. Each run produces an advisory workflow draft. Accepting the draft records continuity events, unresolved branches, and drift warnings where appropriate; rejecting it preserves the decision for provenance.

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
