// API Interceptor - Preload this to log all Anthropic API calls
// Usage: node --import ./api_interceptor.mjs package/cli.js
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";

const __LOG_PATH = "/media/sf_host/dev/claude_code_src/running.log";
let __CALL_NUM = 0;

function log(text) {
  try { appendFileSync(__LOG_PATH, text + "\n"); } catch(e) {}
}

function sep(title) {
  log("");
  log("\u2550".repeat(100));
  log("  " + title);
  log("\u2550".repeat(100));
  log("");
}

function subsep(title) {
  log("");
  log("\u2500".repeat(80));
  log("  " + title);
  log("\u2500".repeat(80));
}

function fj(obj) {
  try { return JSON.stringify(obj, null, 2); } catch(e) { return String(obj); }
}

function tr(s, n) {
  if (typeof s !== "string") return String(s);
  return s.length <= n ? s : s.substring(0, n) + `...[TRUNCATED ${s.length} chars]`;
}

function fmtMsgs(msgs) {
  if (!Array.isArray(msgs)) return fj(msgs);
  const o = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    o.push(`  [${i}] role: ${m.role || "?"}`);
    if (!m.content) continue;
    if (typeof m.content === "string") { o.push(`      ${tr(m.content, 2000)}`); continue; }
    if (!Array.isArray(m.content)) continue;
    for (let j = 0; j < m.content.length; j++) {
      const b = m.content[j];
      if (b.type === "text")
        o.push(`      [${j}] text: ${tr(b.text || "", 3000)}`);
      else if (b.type === "tool_use") {
        o.push(`      [${j}] tool_use: ${b.name} id=${b.id}`);
        o.push(`          input: ${tr(fj(b.input), 2000)}`);
      } else if (b.type === "tool_result") {
        o.push(`      [${j}] tool_result: tool_use_id=${b.tool_use_id}`);
        if (typeof b.content === "string")
          o.push(`          ${tr(b.content, 3000)}`);
        else if (Array.isArray(b.content))
          for (let k = 0; k < b.content.length; k++) {
            const s = b.content[k];
            if (s.type === "text") o.push(`          [${k}] ${tr(s.text || "", 3000)}`);
            else o.push(`          [${k}] ${s.type}: ${tr(fj(s), 1000)}`);
          }
      } else if (b.type === "thinking")
        o.push(`      [${j}] thinking: ${tr(b.thinking || "", 5000)}`);
      else if (b.type === "redacted_thinking")
        o.push(`      [${j}] redacted_thinking: [REDACTED]`);
      else
        o.push(`      [${j}] ${b.type}: ${tr(fj(b), 1000)}`);
    }
  }
  return o.join("\n");
}

function fmtSys(sys) {
  if (!sys) return "(none)";
  if (typeof sys === "string") return tr(sys, 5000);
  if (!Array.isArray(sys)) return fj(sys);
  const o = [];
  for (let i = 0; i < sys.length; i++) {
    const b = sys[i];
    if (b.type === "text") {
      const ci = b.cache_control ? ` [cache: ${fj(b.cache_control)}]` : "";
      o.push(`  [${i}] text${ci}:`);
      o.push(`    ${tr(b.text || "", 3000)}`);
    } else {
      o.push(`  [${i}] ${fj(b)}`);
    }
  }
  return o.join("\n");
}

function fmtTools(tools) {
  if (!tools || !Array.isArray(tools)) return "(none)";
  const o = [`  count: ${tools.length}`];
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    o.push(`  [${i}] ${t.name}${t.cache_control ? " [cached]" : ""}`);
    if (t.description) o.push(`      ${tr(t.description, 200)}`);
  }
  return o.join("\n");
}

function fmtUsage(u) {
  if (!u) return "(none)";
  const p = [];
  if (u.input_tokens != null) p.push(`input=${u.input_tokens}`);
  if (u.output_tokens != null) p.push(`output=${u.output_tokens}`);
  if (u.cache_creation_input_tokens != null) p.push(`cache_create=${u.cache_creation_input_tokens}`);
  if (u.cache_read_input_tokens != null) p.push(`cache_read=${u.cache_read_input_tokens}`);
  return p.join(", ");
}

function logAPIRequest(url, bodyStr) {
  let body;
  try { body = JSON.parse(bodyStr); } catch(e) { return 0; }
  if (!body || (!body.model && !body.messages && !body.system)) return 0;

  __CALL_NUM++;
  const cn = __CALL_NUM;
  const ts = new Date().toISOString();

  sep(`API CALL #${cn} \u2014 ${ts}`);
  log(`URL: ${url}`);

  subsep(`MODEL & PARAMS (call #${cn})`);
  log(`  model:          ${body.model || "?"}`);
  log(`  max_tokens:     ${body.max_tokens || "?"}`);
  log(`  stream:         ${!!body.stream}`);
  if (body.thinking) log(`  thinking:       ${fj(body.thinking)}`);
  if (body.temperature != null) log(`  temperature:    ${body.temperature}`);
  if (body.tool_choice) log(`  tool_choice:    ${fj(body.tool_choice)}`);
  if (body.betas) log(`  betas:          ${fj(body.betas)}`);
  if (body.metadata) log(`  metadata:       ${fj(body.metadata)}`);
  if (body.stop_sequences) log(`  stop_sequences: ${fj(body.stop_sequences)}`);

  subsep(`SYSTEM PROMPT (call #${cn})`);
  log(fmtSys(body.system));

  subsep(`MESSAGES (call #${cn}, ${body.messages ? body.messages.length : 0} msgs)`);
  log(fmtMsgs(body.messages));

  subsep(`TOOLS (call #${cn})`);
  log(fmtTools(body.tools));
  log("");

  return cn;
}

function logSSEStream(cn, fullText) {
  subsep(`SSE STREAM RESPONSE (call #${cn})`);

  const events = fullText.split("\n\n");
  const texts = [], thinks = [], toolParts = [];
  let curTool = null, curToolId = null;
  const toolUses = [];
  let usage = null, stopReason = null, model = null;

  for (const ev of events) {
    const trimmed = ev.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    const lines = trimmed.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const p = JSON.parse(line.substring(6));

        if (p.type === "message_start" && p.message) {
          model = p.message.model;
          usage = p.message.usage;
          log(`  [message_start] model=${model}`);
          if (usage) log(`    initial usage: ${fmtUsage(usage)}`);
        } else if (p.type === "content_block_start" && p.content_block) {
          const blk = p.content_block;
          log(`  [block_start] idx=${p.index} type=${blk.type}`);
          if (blk.type === "tool_use") {
            curTool = blk.name; curToolId = blk.id; toolParts.length = 0;
            log(`    tool: ${blk.name} (id=${blk.id})`);
          } else if (blk.type === "thinking") {
            log(`    [thinking started]`);
          }
        } else if (p.type === "content_block_delta" && p.delta) {
          const d = p.delta;
          if (d.type === "text_delta" && d.text) texts.push(d.text);
          else if (d.type === "thinking_delta" && d.thinking) thinks.push(d.thinking);
          else if (d.type === "input_json_delta" && d.partial_json) toolParts.push(d.partial_json);
        } else if (p.type === "content_block_stop") {
          if (curTool && toolParts.length > 0)
            toolUses.push({ name: curTool, id: curToolId, input: toolParts.join("") });
          curTool = null; toolParts.length = 0;
        } else if (p.type === "message_delta") {
          stopReason = p.delta ? p.delta.stop_reason : null;
          log(`  [message_delta] stop_reason=${stopReason || "?"}`);
          if (p.usage) log(`    output_tokens=${p.usage.output_tokens || 0}`);
        } else if (p.type === "message_stop") {
          log(`  [message_stop]`);
        }
      } catch(pe) {}
    }
  }

  // Reconstructed output
  subsep(`RECONSTRUCTED RESPONSE (call #${cn})`);
  log(`  model: ${model || "?"}  stop_reason: ${stopReason || "?"}`);

  const allText = texts.join("");
  if (allText) {
    log("");
    log("  [TEXT RESPONSE]:");
    log("  " + allText.split("\n").join("\n  "));
  }

  const allThink = thinks.join("");
  if (allThink) {
    log("");
    log("  [THINKING]:");
    log("  " + tr(allThink, 10000).split("\n").join("\n  "));
  }

  for (let ti = 0; ti < toolUses.length; ti++) {
    const tu = toolUses[ti];
    log("");
    log(`  [TOOL_USE #${ti}]: ${tu.name} (id=${tu.id})`);
    try {
      log(`    input: ${tr(fj(JSON.parse(tu.input)), 3000)}`);
    } catch(e) {
      log(`    input(raw): ${tr(tu.input, 3000)}`);
    }
  }

  if (usage) {
    log("");
    log(`  [FINAL USAGE]: ${fmtUsage(usage)}`);
  }

  log("");
  log(`  \u2713 Call #${cn} complete ${new Date().toISOString()}`);
  log("");
}

// Intercept fetch
const origFetch = globalThis.fetch;

globalThis.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));

  // Only intercept Anthropic Messages API
  if (!url.includes("/v1/messages")) return origFetch.apply(this, arguments);

  // Read request body
  let bodyStr = "";
  if (init && init.body && typeof init.body === "string") bodyStr = init.body;

  const cn = logAPIRequest(url, bodyStr);
  const response = await origFetch.apply(this, arguments);

  if (!cn) return response;

  // Determine if streaming
  let isStream = false;
  try { isStream = JSON.parse(bodyStr).stream === true; } catch(e) {}

  if (isStream && response.body) {
    const origReader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];

    const newBody = new ReadableStream({
      start(controller) {
        function read() {
          return origReader.read().then(result => {
            if (result.done) {
              logSSEStream(cn, chunks.join(""));
              controller.close();
              return;
            }
            chunks.push(decoder.decode(result.value, { stream: true }));
            controller.enqueue(result.value);
            return read();
          });
        }
        return read();
      }
    });

    return new Response(newBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // Non-streaming
  if (!isStream) {
    try {
      const cloned = response.clone();
      const respBody = await cloned.json();
      subsep(`RESPONSE (non-streaming, call #${cn})`);
      log(`  model: ${respBody.model || "?"}  stop_reason: ${respBody.stop_reason || "?"}`);
      if (respBody.usage) log(`  usage: ${fmtUsage(respBody.usage)}`);
      if (respBody.content) {
        for (const c of respBody.content) {
          if (c.type === "text") log(`  [TEXT]: ${c.text}`);
          else if (c.type === "tool_use") {
            log(`  [TOOL_USE]: ${c.name} (id=${c.id})`);
            log(`    input: ${tr(fj(c.input), 3000)}`);
          } else if (c.type === "thinking") {
            log(`  [THINKING]: ${tr(c.thinking || "", 5000)}`);
          } else {
            log(`  [${c.type}]: ${tr(fj(c), 2000)}`);
          }
        }
      }
      log("");
    } catch(e) {}
  }

  return response;
};

// Log file initialized
try {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(__LOG_PATH, `=== API Interceptor initialized at ${new Date().toISOString()} ===\n`);
} catch(e) {}
