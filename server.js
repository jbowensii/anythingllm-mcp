// anythingllm-mcp -- zero-dependency stdio MCP server for AnythingLLM.
// Async chat (beats the ~60s MCP tool-call timeout on slow models) + workspace management,
// all over the AnythingLLM REST API. No dependencies: Node stdlib only.
const readline = require("readline");
const { randomUUID } = require("crypto");

const BASE = (process.env.ANYTHINGLLM_BASE_URL || "").replace(/\/+$/, "");
const KEY  = process.env.ANYTHINGLLM_API_KEY || "";
const jobs = new Map(); // job_id -> {status, answer?, sources?, error?, started, elapsed_s?}

function send(m){ process.stdout.write(JSON.stringify(m) + "\n"); }
function ok(id, res){ if (id !== undefined && id !== null) send({ jsonrpc:"2.0", id, result:res }); }
function fail(id, code, message){ if (id !== undefined && id !== null) send({ jsonrpc:"2.0", id, error:{ code, message } }); }
function tr(id, obj){ ok(id, { content:[{ type:"text", text: JSON.stringify(obj) }] }); }

async function api(method, path, body){
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ "Authorization":"Bearer " + KEY }, body ? { "Content-Type":"application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

const TOOLS = [
  { name:"ask_workspace", description:"Async chat query to an AnythingLLM workspace. Returns a job_id instantly so the call never hits the ~60s MCP timeout (use for slow models like Qwen 32B). Poll get_answer until status is 'done'.",
    inputSchema:{ type:"object", properties:{ slug:{type:"string"}, question:{type:"string"}, mode:{type:"string",enum:["query","chat"],description:"query=only indexed docs (default); chat=allow model general knowledge"} }, required:["slug","question"] } },
  { name:"get_answer", description:"Fetch an ask_workspace job by job_id: status pending|done|error, plus answer text and source document titles when done.",
    inputSchema:{ type:"object", properties:{ job_id:{type:"string"} }, required:["job_id"] } },
  { name:"list_workspaces", description:"List all AnythingLLM workspaces (slug, name, chatModel, chatMode, topN).",
    inputSchema:{ type:"object", properties:{} } },
  { name:"get_workspace", description:"Get one workspace's full settings (prompt, model, mode, topN, threshold) and embedded documents.",
    inputSchema:{ type:"object", properties:{ slug:{type:"string"} }, required:["slug"] } },
  { name:"update_workspace", description:"Update a workspace's settings. settings is an object, e.g. {openAiPrompt, openAiTemp, chatMode, topN, similarityThreshold, chatModel, chatProvider, queryRefusalResponse}.",
    inputSchema:{ type:"object", properties:{ slug:{type:"string"}, settings:{type:"object"} }, required:["slug","settings"] } },
  { name:"create_workspace", description:"Create a new workspace by name (AnythingLLM derives the slug).",
    inputSchema:{ type:"object", properties:{ name:{type:"string"} }, required:["name"] } },
  { name:"delete_workspace", description:"Delete a workspace by slug. DESTRUCTIVE -- removes the workspace and its embeddings.",
    inputSchema:{ type:"object", properties:{ slug:{type:"string"} }, required:["slug"] } },
  { name:"list_documents", description:"List documents known to the AnythingLLM system (the document/vector file tree under localFiles).",
    inputSchema:{ type:"object", properties:{} } },
  { name:"update_embeddings", description:"Add or remove documents in a workspace's embeddings. adds/deletes are arrays of document paths from list_documents/get_workspace.",
    inputSchema:{ type:"object", properties:{ slug:{type:"string"}, adds:{type:"array",items:{type:"string"}}, deletes:{type:"array",items:{type:"string"}} }, required:["slug"] } }
];

function startJob(slug, question, mode){
  const id = randomUUID();
  jobs.set(id, { status:"pending", started: Date.now() });
  (async () => {
    try {
      const r = await api("POST", "/api/v1/workspace/" + encodeURIComponent(slug) + "/chat", { message: question, mode: mode || "query" });
      const started = jobs.get(id).started;
      if (!r.ok || (r.data && r.data.error)) jobs.set(id, { status:"error", error: String((r.data && r.data.error) || ("HTTP " + r.status)) });
      else jobs.set(id, { status:"done", answer:(r.data.textResponse||""), sources:[...new Set((r.data.sources||[]).map(s=>s.title))], elapsed_s: Math.round((Date.now()-started)/1000) });
    } catch(e){ jobs.set(id, { status:"error", error:String((e && e.message) || e) }); }
  })();
  return id;
}

async function handleCall(id, params){
  const n = params && params.name, a = (params && params.arguments) || {};
  try {
    switch(n){
      case "ask_workspace":
        if (!a.slug || !a.question) return fail(id, -32602, "slug and question required");
        return tr(id, { job_id: startJob(a.slug, a.question, a.mode), status:"pending", note:"poll get_answer with this job_id" });
      case "get_answer": {
        const j = jobs.get(a.job_id); return tr(id, j || { status:"unknown", error:"no such job_id" });
      }
      case "list_workspaces": {
        const r = await api("GET", "/api/v1/workspaces");
        return tr(id, (r.data.workspaces||[]).map(w=>({ slug:w.slug, name:w.name, chatModel:w.chatModel, chatMode:w.chatMode, topN:w.topN })));
      }
      case "get_workspace":
        if (!a.slug) return fail(id, -32602, "slug required");
        { const w = (await api("GET", "/api/v1/workspace/" + encodeURIComponent(a.slug))).data.workspace; return tr(id, Array.isArray(w) ? (w[0]||{}) : (w||{})); }
      case "update_workspace": {
        if (!a.slug || !a.settings) return fail(id, -32602, "slug and settings required");
        const r = await api("POST", "/api/v1/workspace/" + encodeURIComponent(a.slug) + "/update", a.settings);
        return tr(id, { status: r.ok?"ok":"error", http:r.status, workspace:r.data.workspace, message:r.data.message });
      }
      case "create_workspace": {
        if (!a.name) return fail(id, -32602, "name required");
        const r = await api("POST", "/api/v1/workspace/new", { name:a.name });
        return tr(id, { status: r.ok?"ok":"error", http:r.status, workspace:r.data.workspace, message:r.data.message });
      }
      case "delete_workspace": {
        if (!a.slug) return fail(id, -32602, "slug required");
        const r = await api("DELETE", "/api/v1/workspace/" + encodeURIComponent(a.slug));
        return tr(id, { status: r.ok?"ok":"error", http:r.status });
      }
      case "list_documents":
        return tr(id, (await api("GET", "/api/v1/documents")).data);
      case "update_embeddings": {
        if (!a.slug) return fail(id, -32602, "slug required");
        const r = await api("POST", "/api/v1/workspace/" + encodeURIComponent(a.slug) + "/update-embeddings", { adds:a.adds||[], deletes:a.deletes||[] });
        return tr(id, { status: r.ok?"ok":"error", http:r.status, workspace:r.data.workspace, message:r.data.message });
      }
      default: return fail(id, -32601, "unknown tool: " + n);
    }
  } catch(e){ return tr(id, { status:"error", error:String((e && e.message) || e) }); }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  line = line.trim(); if (!line) return;
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === "initialize") return ok(id, { protocolVersion:(params && params.protocolVersion)||"2024-11-05", capabilities:{ tools:{} }, serverInfo:{ name:"anythingllm-mcp", version:"2.1.0" } });
  if (typeof method === "string" && method.startsWith("notifications/")) return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") return handleCall(id, params);
  if (method === "ping") return ok(id, {});
  return fail(id, -32601, "method not found: " + method);
});