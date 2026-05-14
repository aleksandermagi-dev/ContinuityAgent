# Azari Style Stability Fixture

This is synthetic continuity test material. It is not real Azari code or private project data.

Goal: preserve reasoning continuity across a complex local-first system while keeping validation explicit.

Decision: expose continuity packets and review-gated workflow modules because assistants need compact context without silently mutating durable memory.

Branch: unresolved plugin bridge should stay separate from the continuity service until the API contract is stable.

Drift risk: generated outputs, cache folders, debug logs, and old authority notes can look like project candidates if discovery does not prefer the root.

Run npm test before handoff. Run system_sweep when checking full-system continuity. Run npm run health for a broad stability read.

Long note: The fixture intentionally contains repeated operational language, nested documentation, and project-like internal folders so candidate detection can prove it prefers the actual root. The discovery UI should clamp this preview by default and allow expansion only when the user asks for more detail. This keeps large notes, JSON excerpts, validation reports, and copied logs from overlapping neighboring cards or creating horizontal scroll.
