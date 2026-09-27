# Changelog

## v2.1.0 - 2026-09-27

Packaging & distribution release (no server logic changes).

### Added
- Claude Desktop Extension bundle (`.mcpb`) with a `manifest.json` that prompts for Base URL + API key on install.
- Signed Windows installer (`AnythingLLM-MCP-Setup-*.exe`, Authenticode / SSL.com OV cert) that installs the config-file method and clears SmartScreen.
- README now documents three install methods (extension, manual config, signed installer) and the signing/warning reality.
## v2.0.0 — 2026-09-27

Full replacement for the stock AnythingLLM MCP server: async chat plus workspace
management, zero dependencies.

### Why
Long answers from a slow local model (Qwen 32B, ~4-5 tok/s) exceeded the
non-configurable ~60s MCP tool-call timeout in Claude Desktop / Claude Code
(anthropics/claude-code #43791, #22542), so synchronous `chat_with_workspace`
always failed on the big model. The async pattern below removes the problem
entirely by never blocking a call.

### Added
- `ask_workspace(slug, question, mode?)` + `get_answer(job_id)` — async chat: a
  query returns a job id instantly and is polled for completion, so no call ever
  hits the 60s timeout.
- Workspace management over REST: `list_workspaces`, `get_workspace`,
  `update_workspace`, `create_workspace`, `delete_workspace`, `list_documents`,
  `update_embeddings`.

### Notes
- Zero dependencies (Node stdlib only) — no MCP SDK to drift or be wiped on reinstall.
- Requires Node >= 18 (global `fetch`).
- Intentionally omits the stock server's `initialize_anythingllm` (obsolete,
  buggy auth init) and system-settings tools (not in the REST developer API; use
  the AnythingLLM web UI).