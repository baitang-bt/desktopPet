#!/usr/bin/env node
/**
 * Cursor Agent Hooks → 桌宠状态文件。
 * 由 ~/.cursor/hooks.json 调用；失败必须 fail-open（始终 exit 0 并输出 JSON）。
 *
 * 权限时效策略：
 * - beforeShell/MCP → tool-start（桌宠开始计时）
 * - afterShell/MCP  → tool-end（自动通过则取消提醒）
 * - 若 tool-start 后迟迟没有 tool-end，桌宠判定为「正在等你批准」并立即气泡提醒
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

  if (name === "beforeShellExecution") {
    return {
      kind: "tool-start",
      source: "beforeShellExecution",
      toolName: "Shell",
      detail: String(input.command ?? "").slice(0, 200)
    };
  }

  if (name === "beforeMCPExecution") {
    return {
      kind: "tool-start",
      source: "beforeMCPExecution",
      toolName: input.tool_name ?? "MCP",
      detail: String(input.tool_name ?? "").slice(0, 200)
    };
  }

  if (name === "afterShellExecution") {
    return {
      kind: "tool-end",
      source: "afterShellExecution",
      toolName: "Shell"
    };
  }

  if (name === "afterMCPExecution") {
    return {
      kind: "tool-end",
      source: "afterMCPExecution",
      toolName: input.tool_name ?? "MCP"
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

    if (
      input?.hook_event_name === "beforeShellExecution" ||
      input?.hook_event_name === "beforeMCPExecution"
    ) {
      // 不拦截，只观测；由 Cursor / Auto-review 自己决定是否弹批准卡
      output = { permission: "allow" };
    }
  } catch {
    // fail-open
  }

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

await main();
