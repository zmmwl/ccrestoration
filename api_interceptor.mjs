// API Interceptor — Preload with: node --import ./api_interceptor.mjs package/cli.js
// Logs all Anthropic API calls as raw JSON in Markdown code blocks.
//
// Log path (priority: high → low):
//   1. --api-log <path>          CLI argument
//   2. API_LOG_FILE              Environment variable
//   3. ./prompt_log_YYYYMMDDHHmmss.md  Default (current working directory, with timestamp)
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function defaultLogFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `prompt_log_${ts}.md`;
}

function resolveLogPath() {
  // Check --api-log in argv
  const argv = process.argv;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--api-log") return resolve(argv[i + 1]);
  }
  // Check env var
  if (process.env.API_LOG_FILE) return resolve(process.env.API_LOG_FILE);
  // Default: prompt_log_YYYYMMDDHHmmss.md
  return resolve(defaultLogFilename());
}

const LOG_PATH = resolveLogPath();
let callNum = 0;

function log(text) {
  try { appendFileSync(LOG_PATH, text + "\n"); } catch(e) {}
}

function pretty(obj) {
  try { return JSON.stringify(obj, null, 2); } catch(e) { return String(obj); }
}

// Write the reconstructed full response object (mirrors Anthropic API response shape)
function buildAssistantResponse(sseEvents) {
  const resp = { id: null, type: "message", role: "assistant", content: [], model: null, stop_reason: null, stop_sequence: null, usage: {} };
  let currentBlock = null;
  let toolInputParts = [];

  for (const evt of sseEvents) {
    if (evt.type === "message_start" && evt.message) {
      resp.id = evt.message.id;
      resp.model = evt.message.model;
      resp.usage = { ...evt.message.usage } || {};
    } else if (evt.type === "content_block_start" && evt.content_block) {
      const blk = evt.content_block;
      if (blk.type === "thinking") {
        currentBlock = { type: "thinking", thinking: "" };
      } else if (blk.type === "text") {
        currentBlock = { type: "text", text: "" };
      } else if (blk.type === "tool_use") {
        currentBlock = { type: "tool_use", id: blk.id, name: blk.name, input: {} };
        toolInputParts = [];
      } else {
        currentBlock = { ...blk };
      }
    } else if (evt.type === "content_block_delta" && evt.delta) {
      const d = evt.delta;
      if (d.type === "text_delta" && currentBlock) currentBlock.text += d.text;
      else if (d.type === "thinking_delta" && currentBlock) currentBlock.thinking += d.thinking;
      else if (d.type === "input_json_delta" && currentBlock) toolInputParts.push(d.partial_json);
    } else if (evt.type === "content_block_stop") {
      if (currentBlock) {
        if (currentBlock.type === "tool_use" && toolInputParts.length > 0) {
          try { currentBlock.input = JSON.parse(toolInputParts.join("")); } catch(e) { currentBlock.input = toolInputParts.join(""); }
        }
        resp.content.push(currentBlock);
        currentBlock = null;
      }
    } else if (evt.type === "message_delta" && evt.delta) {
      resp.stop_reason = evt.delta.stop_reason;
      resp.stop_sequence = evt.delta.stop_sequence;
      if (evt.usage) {
        resp.usage.output_tokens = evt.usage.output_tokens;
        if (evt.usage.input_tokens != null) resp.usage.input_tokens = evt.usage.input_tokens;
        if (evt.usage.cache_creation_input_tokens != null) resp.usage.cache_creation_input_tokens = evt.usage.cache_creation_input_tokens;
        if (evt.usage.cache_read_input_tokens != null) resp.usage.cache_read_input_tokens = evt.usage.cache_read_input_tokens;
      }
    }
  }
  return resp;
}

function parseSSEEvents(fullText) {
  const events = [];
  const chunks = fullText.split("\n\n");
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed.startsWith(":")) continue;
    for (const line of trimmed.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try { events.push(JSON.parse(line.substring(6))); } catch(e) {}
    }
  }
  return events;
}

// ── Intercept fetch ──
const origFetch = globalThis.fetch;

globalThis.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
  if (!url.includes("/v1/messages")) return origFetch.apply(this, arguments);

  // ── Parse request body ──
  let bodyStr = "";
  if (init && init.body && typeof init.body === "string") bodyStr = init.body;
  let body;
  try { body = JSON.parse(bodyStr); } catch(e) {}
  if (!body) return origFetch.apply(this, arguments);

  callNum++;
  const cn = callNum;
  const ts = new Date().toISOString();

  // ── Log REQUEST as raw JSON ──
  log(`# API CALL #${cn}`);
  log("");
  log(`> **Time:** ${ts}  `);
  log(`> **URL:** \`${url}\``);
  log("");
  log("## Request");
  log("");
  log("```json");
  log(pretty(body));
  log("```");

  // ── Call original fetch ──
  const response = await origFetch.apply(this, arguments);

  // ── Determine streaming ──
  const isStream = body.stream === true;

  if (isStream && response.body) {
    const origReader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];

    const newBody = new ReadableStream({
      start(controller) {
        function read() {
          return origReader.read().then(result => {
            if (result.done) {
              // ── Log raw SSE events ──
              const sseEvents = parseSSEEvents(chunks.join(""));
              log("");
              log("## SSE Events (raw)");
              log("");
              for (const evt of sseEvents) {
                log("```json");
                log(pretty(evt));
                log("```");
                log("");
              }

              // ── Log reconstructed response ──
              const fullResp = buildAssistantResponse(sseEvents);
              log("## Reconstructed Response");
              log("");
              log("```json");
              log(pretty(fullResp));
              log("```");
              log("");
              log("---");
              log("");

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

  // ── Non-streaming response ──
  if (!isStream) {
    try {
      const cloned = response.clone();
      const respBody = await cloned.json();
      log("");
      log("## Response");
      log("");
      log("```json");
      log(pretty(respBody));
      log("```");
      log("");
      log("---");
      log("");
    } catch(e) {}
  }

  return response;
};

// ── Init log file ──
try {
  writeFileSync(LOG_PATH, `# Claude Code API Log\n\n> Initialized at ${new Date().toISOString()}\n\n---\n\n`);
} catch(e) {}
