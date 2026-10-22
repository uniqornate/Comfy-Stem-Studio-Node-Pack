# Universal Handoff Protocol v1

`AGENTS.md` is canonical. `docs/HANDOFF.md` holds current state and
append-only evidence. Inspect existing work before editing, use
`W-YYYYMMDD-NN` work IDs, keep one next action, and mark `DONE` only with
acceptance evidence. Never rewrite another agent's signed history.

Valid statuses: `TODO`, `IN_PROGRESS`, `BLOCKED`, `WAITING_USER`,
`DONE`, `SUPERSEDED`.

At session close, update active state and prepend a signed entry containing
agent/model, provider, surface, ISO-8601 time, work ID, change, validation,
repo-relative artifacts, and next action. Never record secrets or personal data.