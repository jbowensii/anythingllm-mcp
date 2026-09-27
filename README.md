# anythingllm-mcp

A **zero-dependency** Node MCP (Model Context Protocol) server for
[AnythingLLM](https://anythingllm.com), exposing async chat **and** workspace
management over the AnythingLLM REST API. Node stdlib only - no
`@modelcontextprotocol/sdk`, nothing to break on reinstall, no SDK drift.

## Why we made this

This came out of building a strict, no-fabrication RAG setup in AnythingLLM over
a large local library (tabletop RPG rulebooks) served by self-hosted Ollama.

To stop the model inventing rules, we moved the fact-retrieval workspace onto a
bigger local model (Qwen 32B) for stronger grounding. Bigger local models are
slow on modest VRAM (~4-5 tok/s once the model spills to CPU), so a normal
answer takes well over a minute.

That collided with a hard limit: **the MCP tool-call timeout in Claude Desktop /
Claude Code is ~60 seconds and is not configurable.** The `timeout` field in
`claude_desktop_config.json` and `MCP_TIMEOUT` are not honored for per-call
execution (open issues: anthropics/claude-code
[#43791](https://github.com/anthropics/claude-code/issues/43791),
[#22542](https://github.com/anthropics/claude-code/issues/22542)). Every long
answer from the stock synchronous `chat_with_workspace` died at 60s.

The fix isn't a longer timeout (you can't set one) - it's to **never block a
call**. `ask_workspace` starts the query and returns a `job_id` instantly;
`get_answer` fetches the result when it's ready. No single call is long, so the
timeout never fires, no matter how slow the model. We also recreated the
workspace-management tools over REST so this one server fully replaces the stock
`anythingllm` MCP server.

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
| `update_embeddings(slug, adds?, deletes?)` | Add/remove documents in a workspace's embeddings. |

## Installation - two ways (pick one)

There are two supported ways to add this server to Claude Desktop. **Use one at
a time** - both expose the same 9 tools, so running both together just gives you
duplicate tools.

### Option A - One-click Desktop Extension (`.mcpb`)  *(recommended for most people)*

Download `anythingllm-mcp-<version>.mcpb` from the
[Releases](https://github.com/jbowensii/anythingllm-mcp/releases) page (or build
it yourself: `npx @anthropic-ai/mcpb pack . anythingllm-mcp.mcpb`), then
double-click it - or in Claude Desktop go to **Settings -> Extensions ->
Advanced -> Install extension**. It prompts you for your **AnythingLLM Base URL**
and **API key** and stores them for you.

**Why choose this:** easiest, no hand-editing JSON, no `git` needed; Claude
Desktop manages starting/stopping the server and keeps the key in the
extension's own settings. Best if you just want it working.

### Option B - Manual config (`claude_desktop_config.json`)  *(power users / servers / pinning)*

Clone the repo and add this block under `mcpServers` (see `config.example.json`),
then restart Claude Desktop:

```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "node",
      "args": ["C:\\path\\to\\anythingllm-mcp\\server.js"],
      "env": {
        "ANYTHINGLLM_BASE_URL": "http://your-anythingllm-host:3001",
        "ANYTHINGLLM_API_KEY": "<YOUR_ANYTHINGLLM_API_KEY>"
      }
    }
  }
}
```

**Why choose this:** full control and transparency - you can read/edit the env
and args directly, pin to a specific checkout, `git pull` to update, and script
the same config across machines. Best for homelab/server setups and anyone who
prefers config-as-code over a packaged bundle.

### Option C - Signed Windows installer (`.exe`)  *(easiest for non-technical users)*

Download `AnythingLLM-MCP-Setup-<version>.exe` from the
[Releases](https://github.com/jbowensii/anythingllm-mcp/releases) page and run it.
It is **Authenticode-signed** (SSL.com OV certificate, "John B Owens II"), so it
runs without the "unknown publisher" SmartScreen warning. It prompts for your
Base URL + API key, installs `server.js` to `%LOCALAPPDATA%\anythingllm-mcp`, and
writes the config entry for you. Requires Node.js 18+ on PATH. (Uses the
config-file method under the hood - don't also run the `.mcpb` extension, or
you'll get duplicate tools.)
## The install warning, and signing

Both methods show a one-time "this extension/server isn't verified - allow?"
style prompt. That's **expected and normal** for a community MCP server you
built or downloaded yourself: Claude Desktop is telling you it can't vouch for
the publisher, so *you* are the one vouching for the code. That's reasonable here
- the whole server is ~200 lines of dependency-free JavaScript you can read in
`server.js` before you trust it.

Removing the prompt requires a signature Claude Desktop **trusts**, and that's
harder than it sounds:

- `mcpb sign` (the bundle's own signing command) needs a **local PEM certificate
  + private key** on disk.
- A **self-signed** cert signs the bundle but still shows as an *untrusted*
  publisher - often looking worse than unsigned, so we ship the release
  **unsigned by design**.
- **Cloud / HSM code-signing** (e.g. SSL.com eSigner, DigiCert KeyLocker, Azure
  Trusted Signing) keeps the private key non-exportable, so it can't produce the
  `key.pem` `mcpb sign` needs. And classic **Authenticode / `signtool`** signs
  Windows PE files (`.exe`/`.msi`), not a `.mcpb` (a ZIP with its own signature
  scheme) - so a normal code-signing cert doesn't apply here either.

Bottom line: for a personal/community extension, verify the source and accept
the one-time prompt. Signing only meaningfully helps if you have a CA-chained,
**exportable** code-signing cert to feed `mcpb sign`.

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

- The API key is read from the `ANYTHINGLLM_API_KEY` environment variable - never hard-coded.
- `.gitignore` excludes `.env`, `claude_desktop_config*.json`, and backups so secrets never get committed.

## License

MIT - see `LICENSE`.