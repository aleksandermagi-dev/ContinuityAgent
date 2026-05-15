# Continuity Layer Launch Notes

## Positioning

Continuity Layer is shared project memory for humans and AI agents.

Launch line:

```text
Stop re-explaining your project to AI.
```

The product helps AI builders preserve project context, decisions, checks, branches, drift risks, and review-safe updates so assistants can resume work with compact sourced context instead of a giant prompt dump.

## First Buyer

Primary buyer:

- AI builders using Codex, Claude, Cursor-style tools, local agents, or custom assistant workflows.

Secondary buyers:

- Solo developers with messy long-running projects.
- Indie founders building with AI-heavy iteration.
- Researchers or technical creators with evolving notes, repos, and decisions.

## Early Access Offer

Price:

```text
$19 paid early access
```

What buyers get:

- Windows desktop app.
- Local-first SQLite project memory.
- Project folder scanning and detected checks.
- Project health reports and drift warnings.
- Continuity packets for humans and agents.
- CLI and MCP access for AI tools.
- Direct feedback path while the product is still shaping.

Payment:

- Use an external checkout link through Lemon Squeezy first, or Gumroad/Stripe if needed.
- Do not add in-app billing or license enforcement in this pass.
- Early-access checkout: `https://linnuteeinnovations.lemonsqueezy.com/checkout/buy/d672a3ab-665e-488d-ba78-44f59c0b0140`
- Setup-session requests currently use the feedback form until a dedicated $99 checkout is added.
- Feedback/contact form: `https://tally.so/r/VLbJVy`

## Setup Service Offer

Price:

```text
$99 setup session
```

What buyers get:

- Help scanning their first serious project.
- Continuity packet walkthrough.
- CLI/MCP setup guidance for their AI tool.
- Review-safe workflow explanation.
- Notes on what would make the project easier for agents to assist.

## Demo Script

Use only the synthetic fixture:

```text
fixtures/azari-continuity-trial
```

Demo flow:

1. Open Continuity Layer.
2. Choose `Add Project Folder`.
3. Select the synthetic Azari Continuity Trial fixture.
4. Track the candidate and show detection reasons.
5. Generate Project Health.
6. Show Detected Checks and Project Signals.
7. Fetch a continuity packet:

```bash
npm run continuity -- packet --project "azari-continuity-trial" --budget small
```

8. Record an agent update as a draft:

```bash
npm run continuity -- update --project "azari-continuity-trial" --note "Decision: agent writes stay draft-only until reviewed." --source demo-agent
```

9. Show that the update is pending review and not accepted durable memory.

## Example Prompts

Use these in videos, docs, or live demos:

- “Get a small continuity packet for this project.”
- “What changed recently and what checks should I run?”
- “Record this update as a draft, don’t accept memory automatically.”

## Feedback Path

Feedback form:

```text
https://tally.so/r/VLbJVy
```

Use this for private beta feedback, bug reports, setup-session requests, and follow-up permission.

Ask early users:

- What project did you scan?
- Did the continuity packet reduce explanation time?
- Which agent/tool did you connect?
- What was confusing in setup?
- What would make this worth renewing or recommending?

## Manual Collaborator And Referral Tracking

Start manually before adding affiliate software:

- Give 3-5 collaborators free access.
- Give each collaborator a simple code such as `BUILDER-ALICE`.
- Ask buyers to enter or mention the code at checkout or in the feedback form.
- Track source, buyer name, date, and notes in a spreadsheet or project note.
- Offer a simple manual reward, such as 30% of first sale or free setup help, only after a real sale is attributed.

## Launch Post Templates

Direct founder post:

```text
I built Continuity Layer because I got tired of re-explaining the same project context to AI tools.

It is local-first project memory for humans and AI agents: decisions, drift, detected checks, and compact continuity packets through CLI/MCP.

Early access is $19. Looking for AI builders who want to test it on real messy projects.
```

AI-builder pain-point post:

```text
AI coding tools are powerful, but they still forget why your project is shaped the way it is.

Continuity Layer gives agents a compact, sourced project packet: what changed, why, what is unresolved, and what checks matter.

If you are building with Codex/Claude/Cursor/local agents, I am opening $19 early access.
```

Collaborator outreach DM:

```text
Hey, I built a local-first project memory tool for AI builders called Continuity Layer.

It helps agents stop losing project context by exposing continuity packets, decisions, checks, and draft-only updates through CLI/MCP.

Would you want a free early copy to test or demo? If it fits your audience, I can also track referrals manually for the first launch.
```

## Known Limitations To State Honestly

- Windows is the first packaged target.
- Installer is not code-signed yet.
- No hosted sync or account system.
- No automatic command execution.
- No automatic patch application.
- Agent updates create drafts until reviewed.
