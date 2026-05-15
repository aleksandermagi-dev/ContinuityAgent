# Demo Script

Use only the synthetic fixture:

```text
fixtures/azari-continuity-trial
```

Do not use private Azari data in the public demo.

## 60-90 Second Video

Opening:

```text
AI tools are powerful, but they still forget why your project is shaped the way it is. Continuity Layer is local-first project memory for humans and AI agents.
```

Beat 1: scan a project

```text
I am going to scan this synthetic Azari-style project. It is complex enough to show validation checks, why-layer notes, branches, and drift risks, but it contains no private project data.
```

Show:

- `Add Project Folder`
- candidate detection reasons
- detected stack/checks

Beat 2: track continuity

```text
Continuity Layer does not just create tasks. It tracks current state, decisions, unresolved branches, detected checks, and health signals.
```

Show:

- Project Health
- Detected Checks
- Drift / Contradictions

Beat 3: give context to an agent

```text
Now an AI assistant can ask for a compact continuity packet instead of making me re-explain the whole project.
```

Show:

```bash
npm run continuity -- packet --project "azari-continuity-trial" --budget small
```

Beat 4: draft-only agent update

```text
Agents can record updates, but writes stay review-safe. They create drafts until a human accepts them.
```

Show:

```bash
npm run continuity -- update --project "azari-continuity-trial" --note "Decision: agent writes stay draft-only until reviewed." --source demo-agent
```

Close:

```text
Continuity Layer is for AI builders who are tired of context loss. Early access is $19, with an optional setup session if you want help wiring it into a real project.
```

## Screenshot Checklist

- Add Project Folder
- Candidate detection reasons
- Project Health
- Detected Checks
- Continuity packet output
- CLI/MCP agent access
- Pending draft after agent update
- Known limitations on launch page

## Private Beta Questions

- Did it reduce project re-explaining?
- Which AI tool did you connect?
- What was confusing?
- Would you recommend it?
- What would make it worth $49?
