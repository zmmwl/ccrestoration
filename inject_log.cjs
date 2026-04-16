const fs = require('fs');
const path = require('path');

const cliPath = path.join(__dirname, 'package/cli.js');
const logPath = '/media/sf_host/dev/claude_code_src/running.log';
let content = fs.readFileSync(cliPath, 'utf8');

const loggingCode = `
;var __LOG_PATH = ${JSON.stringify(logPath)};
var __LOG_FS = U6("fs");
var __LOG_CALL_NUM = 0;

function __logWrite(text) {
  try { __LOG_FS.appendFileSync(__LOG_PATH, text + "\\n"); } catch(e) {}
}

function __logSeparator(title) {
  __logWrite("");
  __logWrite("\\u2550".repeat(100));
  __logWrite("  " + title);
  __logWrite("\\u2550".repeat(100));
  __logWrite("");
}

function __logSubSep(title) {
  __logWrite("");
  __logWrite("\\u2500".repeat(80));
  __logWrite("  " + title);
  __logWrite("\\u2500".repeat(80));
}

function __fj(obj) {
  try { return JSON.stringify(obj, null, 2); } catch(e) { return String(obj); }
}

function __tr(s, n) {
  if (typeof s !== "string") return String(s);
  return s.length <= n ? s : s.substring(0, n) + "...[TRUNCATED " + s.length + " chars]";
}

function __fmtMsgs(msgs) {
  if (!Array.isArray(msgs)) return __fj(msgs);
  var o = [];
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    o.push("  [" + i + "] role: " + (m.role || "?"));
    if (!m.content) continue;
    if (typeof m.content === "string") { o.push("      " + __tr(m.content, 2000)); continue; }
    if (!Array.isArray(m.content)) continue;
    for (var j = 0; j < m.content.length; j++) {
      var b = m.content[j];
      if (b.type === "text") o.push("      [" + j + "] text: " + __tr(b.text||"", 3000));
      else if (b.type === "tool_use") { o.push("      [" + j + "] tool_use: " + b.name + " id=" + b.id); o.push("          input: " + __tr(__fj(b.input), 2000)); }
      else if (b.type === "tool_result") {
        o.push("      [" + j + "] tool_result: " + b.tool_use_id);
        if (typeof b.content === "string") o.push("          " + __tr(b.content, 3000));
        else if (Array.isArray(b.content)) for (var k = 0; k < b.content.length; k++) { var s = b.content[k]; if (s.type==="text") o.push("          ["+k+"] "+__tr(s.text||"",3000)); else o.push("          ["+k+"] "+s.type+": "+__tr(__fj(s),1000)); }
      }
      else if (b.type === "thinking") o.push("      [" + j + "] thinking: " + __tr(b.thinking||"", 5000));
      else if (b.type === "redacted_thinking") o.push("      [" + j + "] redacted_thinking: [REDACTED]");
      else o.push("      [" + j + "] " + b.type + ": " + __tr(__fj(b), 1000));
    }
  }
  return o.join("\\n");
}

function __fmtSys(sys) {
  if (!sys) return "(none)";
  if (typeof sys === "string") return __tr(sys, 5000);
  if (!Array.isArray(sys)) return __fj(sys);
  var o = [];
  for (var i = 0; i < sys.length; i++) {
    var b = sys[i];
    if (b.type === "text") {
      var ci = b.cache_control ? " [cache:" + __fj(b.cache_control) + "]" : "";
      o.push("  [" + i + "] text" + ci + ":");
      o.push("    " + __tr(b.text||"", 3000));
    } else o.push("  [" + i + "] " + __fj(b));
  }
  return o.join("\\n");
}

function __fmtTools(tools) {
  if (!tools || !Array.isArray(tools)) return "(none)";
  var o = ["  count: " + tools.length];
  for (var i = 0; i < tools.length; i++) { var t = tools[i]; o.push("  [" + i + "] " + t.name); if (t.description) o.push("      " + __tr(t.description, 200)); }
  return o.join("\\n");
}

function __fmtUsage(u) {
  if (!u) return "(none)";
  var p = [];
  if (u.input_tokens != null) p.push("input=" + u.input_tokens);
  if (u.output_tokens != null) p.push("output=" + u.output_tokens);
  if (u.cache_creation_input_tokens != null) p.push("cache_create=" + u.cache_creation_input_tokens);
  if (u.cache_read_input_tokens != null) p.push("cache_read=" + u.cache_read_input_tokens);
  return p.join(", ");
}

function __logAPIReq(url, bodyStr) {
  var body = null;
  try { body = JSON.parse(bodyStr); } catch(e) { return 0; }
  if (!body || (!body.model && !body.messages && !body.system)) return 0;
  __LOG_CALL_NUM++;
  var cn = __LOG_CALL_NUM;
  var ts = new Date().toISOString();
  __logSeparator("API CALL #" + cn + " \\u2014 " + ts);
  __logWrite("URL: " + url);
  __logSubSep("MODEL & PARAMS");
  __logWrite("  model: " + (body.model||"?"));
  __logWrite("  max_tokens: " + (body.max_tokens||"?"));
  __logWrite("  stream: " + !!body.stream);
  if (body.thinking) __logWrite("  thinking: " + __fj(body.thinking));
  if (body.temperature != null) __logWrite("  temperature: " + body.temperature);
  if (body.tool_choice) __logWrite("  tool_choice: " + __fj(body.tool_choice));
  if (body.betas) __logWrite("  betas: " + __fj(body.betas));
  if (body.metadata) __logWrite("  metadata: " + __fj(body.metadata));
  __logSubSep("SYSTEM PROMPT (call #" + cn + ")");
  __logWrite(__fmtSys(body.system));
  __logSubSep("MESSAGES (call #" + cn + ", " + (body.messages?body.messages.length:0) + " msgs)");
  __logWrite(__fmtMsgs(body.messages));
  __logSubSep("TOOLS (call #" + cn + ")");
  __logWrite(__fmtTools(body.tools));
  __logWrite("");
  return cn;
}

function __logSSE(cn, fullText) {
  __logSubSep("SSE STREAM (call #" + cn + ")");
  var evts = fullText.split("\\n\\n");
  var texts = [], thinks = [], toolParts = [], tools = [];
  var curTool = null, curToolId = null, usage = null, stop = null, model = null;
  for (var ei = 0; ei < evts.length; ei++) {
    var ev = evts[ei].trim();
    if (!ev || ev.startsWith(":")) continue;
    var lines = ev.split("\\n");
    for (var li = 0; li < lines.length; li++) {
      if (!lines[li].startsWith("data: ")) continue;
      try {
        var p = JSON.parse(lines[li].substring(6));
        if (p.type === "message_start" && p.message) { model = p.message.model; usage = p.message.usage; __logWrite("  [message_start] model=" + model); }
        else if (p.type === "content_block_start" && p.content_block) {
          var blk = p.content_block;
          __logWrite("  [block_start] idx=" + p.index + " type=" + blk.type);
          if (blk.type === "tool_use") { curTool = blk.name; curToolId = blk.id; toolParts = []; __logWrite("    tool: " + blk.name); }
          else if (blk.type === "thinking") __logWrite("    [thinking started]");
        }
        else if (p.type === "content_block_delta" && p.delta) {
          if (p.delta.type === "text_delta" && p.delta.text) texts.push(p.delta.text);
          else if (p.delta.type === "thinking_delta" && p.delta.thinking) thinks.push(p.delta.thinking);
          else if (p.delta.type === "input_json_delta" && p.delta.partial_json) toolParts.push(p.delta.partial_json);
        }
        else if (p.type === "content_block_stop") {
          if (curTool && toolParts.length > 0) tools.push({name:curTool, id:curToolId, input:toolParts.join("")});
          curTool = null; toolParts = [];
        }
        else if (p.type === "message_delta") {
          stop = p.delta ? p.delta.stop_reason : null;
          __logWrite("  [message_delta] stop_reason=" + stop);
          if (p.usage) __logWrite("    output_tokens=" + (p.usage.output_tokens||0));
        }
        else if (p.type === "message_stop") __logWrite("  [message_stop]");
      } catch(pe) {}
    }
  }
  __logSubSep("RECONSTRUCTED RESPONSE (call #" + cn + ")");
  __logWrite("  model: " + (model||"?") + "  stop_reason: " + (stop||"?"));
  var allText = texts.join("");
  if (allText) { __logWrite(""); __logWrite("  [TEXT]:"); __logWrite("  " + allText.split("\\n").join("\\n  ")); }
  var allThink = thinks.join("");
  if (allThink) { __logWrite(""); __logWrite("  [THINKING]:"); __logWrite("  " + __tr(allThink, 10000).split("\\n").join("\\n  ")); }
  for (var ti = 0; ti < tools.length; ti++) {
    var tu = tools[ti];
    __logWrite(""); __logWrite("  [TOOL_USE #" + ti + "]: " + tu.name + " (id=" + tu.id + ")");
    try { __logWrite("    input: " + __tr(__fj(JSON.parse(tu.input)), 3000)); } catch(e) { __logWrite("    input(raw): " + __tr(tu.input, 3000)); }
  }
  if (usage) { __logWrite(""); __logWrite("  [USAGE]: " + __fmtUsage(usage)); }
  __logWrite(""); __logWrite("  \\u2713 Call #" + cn + " complete " + new Date().toISOString());
  __logWrite("");
}

(function() {
  var sf = globalThis.fetch;
  if (typeof sf !== "function") return;
  globalThis.fetch = async function(input, init) {
    var url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
    if (url.indexOf("/v1/messages") === -1) return sf.apply(this, arguments);
    var bodyStr = (init && init.body && typeof init.body === "string") ? init.body : "";
    var cn = __logAPIReq(url, bodyStr);
    var resp = await sf.apply(this, arguments);
    if (!cn) return resp;
    var isStream = false;
    try { isStream = JSON.parse(bodyStr).stream === true; } catch(e) {}
    if (isStream && resp.body) {
      var cn2 = cn;
      var or = resp.body.getReader();
      var dc = new TextDecoder();
      var chunks = [];
      var nb = new ReadableStream({
        start: function(c) {
          function rd() { return or.read().then(function(r) { if (r.done) { __logSSE(cn2, chunks.join("")); c.close(); return; } chunks.push(dc.decode(r.value, {stream:true})); c.enqueue(r.value); return rd(); }); }
          return rd();
        }
      });
      return new Response(nb, {status:resp.status, statusText:resp.statusText, headers:resp.headers});
    }
    if (!isStream) {
      var cn3 = cn;
      try { var cl = resp.clone(); var rb = await cl.json(); __logSubSep("RESPONSE (non-stream, call #"+cn3+")"); __logWrite("  model: "+(rb.model||"?")+" stop_reason: "+(rb.stop_reason||"?")); if (rb.usage) __logWrite("  usage: "+__fmtUsage(rb.usage)); if (rb.content) for (var i=0;i<rb.content.length;i++){var c=rb.content[i]; if(c.type==="text") __logWrite("  [TEXT]: "+c.text); else if(c.type==="tool_use"){__logWrite("  [TOOL_USE]: "+c.name+" id="+c.id); __logWrite("    input: "+__tr(__fj(c.input),3000));} else if(c.type==="thinking") __logWrite("  [THINKING]: "+__tr(c.thinking||"",5000)); else __logWrite("  ["+c.type+"]: "+__tr(__fj(c),2000));} __logWrite(""); } catch(e){}
    }
    return resp;
  };
})();
`;

// Insert after U6=_K5(import.meta.url)
const anchor = 'U6=_K5(import.meta.url)';
const anchorPos = content.indexOf(anchor);
if (anchorPos === -1) {
  console.error('ERROR: Could not find anchor point');
  process.exit(1);
}

const injectPoint = anchorPos + anchor.length;
const newContent = content.slice(0, injectPoint) + loggingCode + content.slice(injectPoint);

fs.writeFileSync(cliPath, newContent, 'utf8');
console.log('SUCCESS: API logging injected');
