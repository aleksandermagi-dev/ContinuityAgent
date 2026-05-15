#!/usr/bin/env node
import {
  getContextPacket,
  getDetectedChecks,
  getRecentChanges,
  getRelevantDecisions,
  listProjects,
  recordProjectUpdate
} from "./continuity-api.mjs";

const tools = [
  {
    name: "list_projects",
    description: "List Continuity Layer projects available through the local API.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_context_packet",
    description: "Get compact, sourced project context for an AI or human handoff.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project id, exact name, or unique partial name." },
        budget: { type: "string", enum: ["small", "medium", "large"], default: "medium" }
      },
      required: ["project"],
      additionalProperties: false
    }
  },
  {
    name: "get_recent_changes",
    description: "Get recent project timeline changes.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }
  },
  {
    name: "get_relevant_decisions",
    description: "Find accepted project decisions relevant to a topic.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        topic: { type: "string" }
      },
      required: ["project", "topic"],
      additionalProperties: false
    }
  },
  {
    name: "get_detected_checks",
    description: "Get detected test/build/lint/validation commands for a project.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }
  },
  {
    name: "record_project_update",
    description: "Record a project update as a reviewable draft. This never accepts memory or mutates source files.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        note: { type: "string" },
        source: { type: "string", default: "mcp-agent" }
      },
      required: ["project", "note"],
      additionalProperties: false
    }
  }
];

async function callTool(name, args = {}) {
  if (name === "list_projects") return listProjects();
  if (name === "get_context_packet") return getContextPacket(args.project, args.budget ?? "medium");
  if (name === "get_recent_changes") return getRecentChanges(args.project);
  if (name === "get_relevant_decisions") return getRelevantDecisions(args.project, args.topic ?? "");
  if (name === "get_detected_checks") return getDetectedChecks(args.project);
  if (name === "record_project_update") return recordProjectUpdate(args.project, args.note, args.source ?? "mcp-agent");
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(request) {
  if (request.method === "initialize") {
    result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "continuity-layer", version: "0.1.0" }
    });
    return;
  }
  if (request.method === "tools/list") {
    result(request.id, { tools });
    return;
  }
  if (request.method === "tools/call") {
    try {
      const payload = await callTool(request.params?.name, request.params?.arguments ?? {});
      result(request.id, {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError: false
      });
    } catch (err) {
      result(request.id, {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true
      });
    }
    return;
  }
  if (request.id !== undefined) error(request.id, -32601, `Method not found: ${request.method}`);
}

let buffer = Buffer.alloc(0);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk, "utf8")]);
  while (buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      const newlineEnd = buffer.indexOf("\n");
      if (newlineEnd === -1) return;
      const line = buffer.subarray(0, newlineEnd).toString("utf8").trim();
      buffer = buffer.subarray(newlineEnd + 1);
      if (!line) continue;
      try {
        void handle(JSON.parse(line));
      } catch (err) {
        error(null, -32700, err instanceof Error ? err.message : String(err));
      }
      continue;
    }
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      error(null, -32700, "Missing Content-Length header.");
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    try {
      void handle(JSON.parse(body));
    } catch (err) {
      error(null, -32700, err instanceof Error ? err.message : String(err));
    }
  }
});
