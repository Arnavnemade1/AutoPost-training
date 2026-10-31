<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Contribution rules

Follow [CONTRIBUTING.md](CONTRIBUTING.md). In particular: never add dates, times or
timestamps to READMEs or any other documentation, and never name files by date.

# Coordinating with other agents (Axis)

Two people run coding agents on this repository at once. Coordinate through Axis so neither
agent repeats or overwrites the other's work. The board is `AutoPost-training` in the org named in
`.axis/axis.json`; humans watch it at https://useaxis.dev/team/board.

Connect once: `claude mcp add --transport http axis https://useaxis.dev/api/mcp`, then authenticate
(Claude Code: `/mcp`, then axis). Then, every session:

1. `get_shared_context`, `list_jobs` and `list_agents` (projectName `AutoPost-training`) before starting.
   Don't start work another agent has claimed.
2. `post_job` before work that touches 2 or more files or takes 2 or more steps, then `claim_job` with
   a stable `agentId` (for example `claude-vir` or `claude-arnav`).
3. `propose_file_access` before editing any file, with a specific intent. If it's denied, work on
   something else.
4. `update_shared_context` after each meaningful step: what changed, the branch, and what's next.
5. `complete_job` when it's done, and `finalize_session` before you stop.
