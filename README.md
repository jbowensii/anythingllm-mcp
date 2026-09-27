# anythingllm-mcp

A **zero-dependency** Node MCP (Model Context Protocol) server for
[AnythingLLM](https://anythingllm.com), exposing async chat **and** workspace
management over the AnythingLLM REST API. Node stdlib only — no
`@modelcontextprotocol/sdk`, nothing to break on reinstall, no SDK drift.

## Why

The MCP tool-call timeout in Claude Desktop / Claude Code is ~60s and is **not**
configurable (the `timeout` config field and `MCP_TIMEOUT` are not honored for
per-call execution — anthropics/claude-code #43791, #22542). Slow local models
(e.g. Qwen 32B on modest VRAM, ~4-5 tok/s) blow past that on a normal answer.

Instead of fighting the timeout, `ask_workspace` starts the query and returns a
`job_id` **instantly**; `get_answer` fetches the result when ready. No single
call ever blocks, so the timeout never fires.

## Tools

| Tool | Purpose |
|------|---------|
| `ask_workspace(slug, question, mode?)` | Start an async chat query. Returns a `job_id` immediately. `mode`: `query` (docs only, default) or `chat` (allow model general knowledge). |
| `get_answer(job_id)` | Fetch a job: `status` pending\|done\|error, plus `answer` and source titles when done. |
| `list_workspaces()` | All workspaces (slug, name, chatModel, chatMode, topN). |
| `get_workspace(slug)` | One workspace's full settings + embedded documents. |
| `update_workspace(slug, settings)` | Update settings (`openAiPrompt`, `openAiTemp`, `chatMode`, `topN`, `similarityThreshold`, `chatModel`, `chatProvider`, `queryRefusalResponse`, ...). |
| `create_workspace(name)` | Create a workspace. |
| `delete_workspace(slug)` | Delete a workspace (destructive). |
| `list_documents()` | System document/vector file tree (`localFiles`). |
| `update_embeddings(slug, adds?, deletes?)` | Add/remove documents in a workspace's embeddings (paths from `list_documents`/`get_workspace`). |

## Install

1. `git clone` this repo (e.g. to `C:\Tools\anythingllm-async-mcp`). No `npm install` needed.
2. Register it in Claude Desktop's `claude_desktop_config.json` (see `config.example.json`):

```json
{
  "mcpServers": {
    "anythingllm-async": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Tools\\anythingllm-async-mcp\\server.js"],
      "env": {
        "ANYTHINGLLM_BASE_URL": "http://your-anythingllm-host:3001",
        "ANYTHINGLLM_API_KEY": "<YOUR_ANYTHINGLLM_API_KEY>"
      }
    }
  }
}
```

3. Restart Claude Desktop. It launches/stops the server automatically.

## Usage

- **Query:** `ask_workspace` with a workspace `slug` + question -> note the `job_id`.
  Then `get_answer(job_id)`; if `pending`, wait ~15-30s and call again.
- **Manage:** `list_workspaces`, `get_workspace`, `update_workspace`, etc. return immediately.

## Requirements

- Node.js >= 18 (uses the built-in global `fetch`).
- An AnythingLLM instance with a Developer API key (Settings -> Tools -> Developer API).

## Development

```
node --check server.js     # syntax
node test.js               # end-to-end smoke test (drives the MCP protocol over stdio)
```
`test.js` reads the env from your Claude Desktop config for convenience.

## Security

- The API key is read from the `ANYTHINGLLM_API_KEY` environment variable — never hard-coded.
- `.gitignore` excludes `.env`, `claude_desktop_config*.json`, and backups so secrets never get committed.

## License

MIT — see `LICENSE`.