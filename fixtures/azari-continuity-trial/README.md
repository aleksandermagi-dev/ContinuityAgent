# Azari Continuity Trial

This is a synthetic benchmark fixture for Project Continuity Agent. It is not real Azari code or private data.

## Goal

Test whether a continuity layer can track a highly intricate why-layer project without flattening it into simple task management.

## Current State

The project contains a relational continuity agent, a validation sweep, evolving memory rules, unresolved integration branches, and a strong need for compact project handoff packets.

## Decisions

- Decision: keep the project continuity helper standalone because Azari should remain a separate agent and client.
- Decision: use review-before-accept for extracted memory because durable project state needs explicit approval.
- Decision: expose compact context packets because assistants need lower-token project continuity.

## Branches

- Branch: local API plugin bridge for Azari remains unresolved.
- Branch: automatic check execution is paused until approval and safety rules exist.
- Branch: cross-project linking could be useful, but must remain explicit.

## Drift Risks

- Drift risk: confusing the benchmark with the product identity.
- Drift risk: treating project memory as task management only.
- Drift risk: accepting generated decisions without review.

## Validation

Run these before handoff:

```bash
npm test
npm run build
python -m azari.validation.system_sweep
system_sweep
```
