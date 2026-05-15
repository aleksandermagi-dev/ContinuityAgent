# Release Checklist

## Build

Run:

```bash
npm test
npm run build
npm run verify
```

Run Rust/Tauri checks:

```bash
cd src-tauri
cargo test
cd ..
npm run tauri:build
```

Current Windows installer output:

```text
src-tauri\target\release\bundle\nsis\Continuity Layer_0.1.0_x64-setup.exe
```

Current standalone app output:

```text
src-tauri\target\release\continuity-layer.exe
```

## Smoke Test

- Open the web app at `http://127.0.0.1:5173`.
- Confirm the API responds at `http://127.0.0.1:8787/api/projects`.
- Install or run the Tauri app.
- Scan `fixtures/azari-continuity-trial`.
- Track the candidate.
- Generate Project Health.
- Confirm Detected Checks and Project Signals appear.
- Fetch a continuity packet with the CLI.
- Record an agent update and confirm it creates a pending draft.
- Confirm no imported source files are modified.

## Launch Page

- Open `site/index.html` through a local static server.
- Confirm the page contains:
  - `Continuity Layer Early Access - $19`
  - `Setup Session - $99`
  - `https://linnuteeinnovations.lemonsqueezy.com/checkout/buy/d672a3ab-665e-488d-ba78-44f59c0b0140`
  - `https://tally.so/r/VLbJVy`
  - `Known limitations`
  - `What happens after purchase`
- Dedicated $99 setup checkout is still optional; setup requests currently use the feedback form.
- Confirm demo copy only references `fixtures/azari-continuity-trial`.

## Agent Access

CLI:

```bash
npm run continuity -- projects
npm run continuity -- packet --project "Project name" --budget small
```

MCP:

```bash
npm run mcp
```

Confirm tools:

- `list_projects`
- `get_context_packet`
- `get_recent_changes`
- `get_relevant_decisions`
- `get_detected_checks`
- `record_project_update`

## Signing Status

Current status:

```text
Not code-signed yet.
```

Before a broader paid release, add code signing so Windows SmartScreen is less alarming.

## Do Not Commit

These must remain ignored/generated:

- `node_modules/`
- `dist/`
- `data/`
- `pics/`
- `src-tauri/target/`
- `.env`
- `.vite/`
- coverage output

## Known Limitations

- Windows is the first packaged target.
- Desktop app is local-first only.
- No billing, license enforcement, hosted accounts, or sync.
- No automatic project command execution.
- No automatic patch application.
- Agent updates and workflow outputs require review.

## Release Notes Template

```md
# Continuity Layer 0.1.0 Early Access

Continuity Layer is shared project memory for humans and AI agents.

Included:
- Windows desktop app
- Local SQLite project memory
- Project folder scanning
- Health and drift reports
- Continuity packets
- CLI and MCP agent access
- Review-safe agent updates
- $19 early-access package
- Optional $99 setup session

Known limitations:
- Not code-signed yet
- Windows-first package
- No hosted sync
- No automatic command execution
```
