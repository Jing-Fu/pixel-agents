import type * as vscode from 'vscode';

import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import { formatToolStatus } from './transcriptParser.js';
import type { AgentState } from './types.js';

interface CodexResponseItemRecord {
  type: 'response_item';
  payload?: Record<string, unknown>;
}

interface CodexEventRecord {
  type: 'event_msg';
  payload?: Record<string, unknown>;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed tool arguments.
  }
  return {};
}

function firstItemText(items: unknown): string {
  if (!Array.isArray(items)) return '';
  for (const item of items) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).text === 'string'
    ) {
      return (item as Record<string, unknown>).text as string;
    }
  }
  return '';
}

function normalizeCodexToolCall(
  name: string,
  args: Record<string, unknown>,
): { toolName: string; status: string } {
  switch (name) {
    case 'exec_command':
      return {
        toolName: 'Bash',
        status: formatToolStatus('Bash', { command: args.cmd }),
      };
    case 'write_stdin':
      return {
        toolName: 'Bash',
        status:
          typeof args.chars === 'string' && args.chars.trim()
            ? 'Interacting with command'
            : 'Waiting on command',
      };
    case 'read_thread_terminal':
      return {
        toolName: 'Read',
        status: 'Reading terminal',
      };
    case 'apply_patch':
      return {
        toolName: 'Edit',
        status: 'Editing files',
      };
    case 'spawn_agent':
      return {
        toolName: 'Agent',
        status: formatToolStatus('Agent', {
          description:
            (typeof args.message === 'string' ? args.message : '') || firstItemText(args.items),
        }),
      };
    case 'wait_agent':
      return {
        toolName: 'Agent',
        status: 'Waiting for sub-agent',
      };
    case 'send_input':
      return {
        toolName: 'Agent',
        status: 'Messaging sub-agent',
      };
    case 'update_plan':
      return {
        toolName: 'EnterPlanMode',
        status: 'Planning',
      };
    case 'automation_update':
      return {
        toolName: 'Write',
        status: 'Updating automation',
      };
    case 'multi_tool_use.parallel':
      return {
        toolName: 'Task',
        status: 'Running parallel tools',
      };
    default:
      if (name.startsWith('mcp__pencil__batch_get')) {
        return { toolName: 'Read', status: 'Inspecting design' };
      }
      if (name.startsWith('mcp__pencil__get_')) {
        return { toolName: 'Read', status: 'Reading design data' };
      }
      if (
        name.startsWith('mcp__pencil__batch_design') ||
        name.startsWith('mcp__pencil__set_') ||
        name.startsWith('mcp__pencil__replace_')
      ) {
        return { toolName: 'Edit', status: 'Editing design' };
      }
      return {
        toolName: name,
        status: `Using ${name}`,
      };
  }
}

function handleResponseItem(
  agentId: number,
  record: CodexResponseItemRecord,
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const payload = record.payload || {};
  const responseType = payload.type;

  if (responseType === 'function_call') {
    const callId =
      (typeof payload.call_id === 'string' && payload.call_id) ||
      (typeof payload.id === 'string' && payload.id);
    const name = typeof payload.name === 'string' ? payload.name : '';
    if (!callId || !name) return;

    const args = parseJsonObject(payload.arguments);
    const { toolName, status } = normalizeCodexToolCall(name, args);
    agent.activeToolIds.add(callId);
    agent.activeToolStatuses.set(callId, status);
    agent.activeToolNames.set(callId, toolName);
    agent.isWaiting = false;
    agent.permissionSent = false;

    webview?.postMessage({
      type: 'agentToolStart',
      id: agentId,
      toolId: callId,
      status,
      toolName,
      permissionActive: false,
    });
    return;
  }

  if (responseType === 'function_call_output') {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
    if (!callId || !agent.activeToolIds.has(callId)) return;

    const toolName = agent.activeToolNames.get(callId);
    agent.activeToolIds.delete(callId);
    agent.activeToolStatuses.delete(callId);
    agent.activeToolNames.delete(callId);
    if (toolName === 'Agent' || toolName === 'Task') {
      webview?.postMessage({
        type: 'subagentClear',
        id: agentId,
        parentToolId: callId,
      });
    }
    webview?.postMessage({
      type: 'agentToolDone',
      id: agentId,
      toolId: callId,
    });
    return;
  }

  if (responseType === 'message') {
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'active',
    });
  }
}

function handleEventMessage(
  agentId: number,
  record: CodexEventRecord,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const payload = record.payload || {};
  const eventType = payload.type;

  if (eventType === 'task_started') {
    cancelWaitingTimer(agentId, waitingTimers);
    cancelPermissionTimer(agentId, permissionTimers);
    agent.isWaiting = false;
    agent.permissionSent = false;
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'active',
    });
    return;
  }

  if (eventType === 'user_message') {
    cancelWaitingTimer(agentId, waitingTimers);
    clearAgentActivity(agent, agentId, permissionTimers, webview);
    agent.isWaiting = false;
    return;
  }

  if (eventType === 'task_complete') {
    cancelWaitingTimer(agentId, waitingTimers);
    cancelPermissionTimer(agentId, permissionTimers);
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (toolName === 'Agent' || toolName === 'Task') {
        webview?.postMessage({
          type: 'subagentClear',
          id: agentId,
          parentToolId: toolId,
        });
      }
    }
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
    agent.backgroundAgentToolIds.clear();
    agent.isWaiting = true;
    agent.permissionSent = false;
    webview?.postMessage({ type: 'agentToolsClear', id: agentId });
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
    });
  }
}

export function processCodexTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.lastDataAt = Date.now();
  agent.linesProcessed++;

  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.type === 'response_item') {
      handleResponseItem(agentId, record as unknown as CodexResponseItemRecord, agents, webview);
      return;
    }

    if (record.type === 'event_msg') {
      handleEventMessage(
        agentId,
        record as unknown as CodexEventRecord,
        agents,
        waitingTimers,
        permissionTimers,
        webview,
      );
    }
  } catch {
    // Ignore malformed lines.
  }
}
