#!/usr/bin/env node
/**
 * Cursor Agent Hooks → 桌宠状态文件。
 * 由 ~/.cursor/hooks.json 调用；失败必须 fail-open（始终 exit 0 并输出 JSON）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATUS_FILE = path.join(os.homedir(), ".cursor", "desktop-pet-agent-status.json");

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return { version: 1, seq: 0 };
  }
}

function writeEvent(event) {
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  const previous = readPrevious();
  const next = {
    version: 1,
    seq: Number(previous.seq || 0) + 1,
    at: Date.now(),
    ...event
  };
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(next)}\n`, "utf8");
}

function mapEvent(input) {
  const name = String(input?.hook_event_name ?? "");

  if (name === "stop" && input?.status === "completed") {
    return {
      kind: "complete",
      source: "stop",
      status: "completed",
      conversationId: input.conversation_id ?? null
    };
  }

  if (name === "postToolUseFailure" && input?.failure_type === "permission_denied") {
    return {
      kind: "permission",
      source: "postToolUseFailure",
      status: "permission_denied",
      toolName: input.tool_name ?? null
    };
  }

  return null;
}

async function main() {
  let output = {};

  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const event = mapEvent(input);

    if (event) {
      writeEvent(event);
    }

    // before* hooks 若被挂上也保持放行
    if (
      input?.hook_event_name === "beforeShellExecution" ||
      input?.hook_event_name === "beforeMCPExecution"
    ) {
      output = { permission: "allow" };
    }
  } catch {
    // fail-open
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

await main();
