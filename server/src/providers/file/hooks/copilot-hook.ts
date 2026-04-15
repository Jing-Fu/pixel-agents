import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, SERVER_JSON_DIR, SERVER_JSON_NAME } from '../../../constants.js';
import type { ServerConfig } from '../../../server.js';

const SERVER_JSON = path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);
const COPILOT_SESSION_MAP = path.join(os.homedir(), SERVER_JSON_DIR, 'copilot-sessions.json');
const MAX_SESSION_DIR_SCAN = 24;
const SESSION_SEARCH_WINDOW_MS = 6 * 60 * 60 * 1000;

interface SessionBinding {
  sessionId: string;
  updatedAt: number;
}

type SessionBindings = Record<string, SessionBinding>;

function getCopilotHome(): string {
  return process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function normalizePathKey(value: string): string {
  return path.resolve(value).toLowerCase();
}

function readBindings(): SessionBindings {
  try {
    if (!fs.existsSync(COPILOT_SESSION_MAP)) return {};
    return JSON.parse(fs.readFileSync(COPILOT_SESSION_MAP, 'utf-8')) as SessionBindings;
  } catch {
    return {};
  }
}

function writeBindings(bindings: SessionBindings): void {
  const dir = path.dirname(COPILOT_SESSION_MAP);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(COPILOT_SESSION_MAP, JSON.stringify(bindings, null, 2), 'utf-8');
}

function fileContainsCwd(filePath: string, cwd: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32_768);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const snippet = buf.toString('utf-8', 0, bytesRead);
    return snippet.includes(cwd);
  } catch {
    return false;
  }
}

function findRecentSessionId(copilotHome: string, cwd: string): string | undefined {
  const sessionsDir = path.join(copilotHome, 'session-state');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sessionDir = path.join(sessionsDir, entry.name);
      const eventsPath = path.join(sessionDir, 'events.jsonl');
      try {
        const stat = fs.statSync(eventsPath);
        return {
          sessionId: entry.name,
          eventsPath,
          mtimeMs: stat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { sessionId: string; eventsPath: string; mtimeMs: number } => !!entry)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SESSION_DIR_SCAN);

  const now = Date.now();
  let fallback: string | undefined;

  for (const candidate of dirs) {
    if (now - candidate.mtimeMs > SESSION_SEARCH_WINDOW_MS) break;
    fallback ??= candidate.sessionId;
    if (cwd && fileContainsCwd(candidate.eventsPath, cwd)) {
      return candidate.sessionId;
    }
  }

  return fallback;
}

function resolveSessionId(eventName: string, cwd: string, copilotHome: string): string {
  const bindings = readBindings();
  const cwdKey = cwd ? normalizePathKey(cwd) : '';
  const existing = cwdKey ? bindings[cwdKey] : undefined;
  const discovered = cwd ? findRecentSessionId(copilotHome, cwd) : undefined;
  const sessionId =
    (eventName === 'sessionStart'
      ? discovered || existing?.sessionId
      : existing?.sessionId || discovered) ||
    `copilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (!cwdKey) return sessionId;

  if (eventName === 'sessionEnd') {
    if (bindings[cwdKey]) {
      delete bindings[cwdKey];
      writeBindings(bindings);
    }
    return sessionId;
  }

  bindings[cwdKey] = {
    sessionId,
    updatedAt: Date.now(),
  };
  writeBindings(bindings);
  return sessionId;
}

function parseToolArgs(toolArgs: unknown): Record<string, unknown> {
  if (typeof toolArgs !== 'string' || !toolArgs.trim()) return {};
  try {
    const parsed = JSON.parse(toolArgs);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed tool args.
  }
  return {};
}

function normalizeReason(reason: unknown): string {
  if (typeof reason !== 'string' || !reason) return 'unknown';
  switch (reason) {
    case 'user_exit':
      return 'exit';
    default:
      return reason;
  }
}

function buildPayload(eventName: string, data: Record<string, unknown>, sessionId: string) {
  const cwd = typeof data.cwd === 'string' ? data.cwd : '';

  switch (eventName) {
    case 'sessionStart':
      return {
        hook_event_name: 'SessionStart',
        session_id: sessionId,
        cwd,
        source: data.source,
      };
    case 'sessionEnd':
      return {
        hook_event_name: 'SessionEnd',
        session_id: sessionId,
        cwd,
        reason: normalizeReason(data.reason),
      };
    case 'userPromptSubmitted':
      return {
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        cwd,
        prompt: data.prompt,
      };
    case 'preToolUse':
      return {
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd,
        tool_name: data.toolName,
        tool_input: parseToolArgs(data.toolArgs),
      };
    case 'postToolUse':
      return {
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        cwd,
        tool_name: data.toolName,
        tool_input: parseToolArgs(data.toolArgs),
        tool_result: data.toolResult,
      };
    case 'errorOccurred':
      return {
        hook_event_name: 'PostToolUseFailure',
        session_id: sessionId,
        cwd,
        message: data.message,
      };
    default:
      return null;
  }
}

async function postPayload(server: ServerConfig, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(payload);
  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `${HOOK_API_PREFIX}/copilot`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: 2000,
      },
      () => resolve(),
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(body);
  });
}

async function main(): Promise<void> {
  const eventName = process.argv[2];
  if (!eventName) process.exit(0);

  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: Record<string, unknown>;
  let server: ServerConfig;
  try {
    data = JSON.parse(input);
    server = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8')) as ServerConfig;
  } catch {
    process.exit(0);
  }

  const cwd = typeof data.cwd === 'string' ? data.cwd : '';
  const sessionId = resolveSessionId(eventName, cwd, getCopilotHome());
  const payload = buildPayload(eventName, data, sessionId);
  if (!payload) process.exit(0);

  await postPayload(server, payload);

  // Copilot hooks don't expose a dedicated "turn complete" event, so we treat
  // post-tool completion as the closest waiting-state boundary for Pixel Agents.
  if (eventName === 'postToolUse' || eventName === 'errorOccurred') {
    await postPayload(server, {
      hook_event_name: 'Stop',
      session_id: sessionId,
      cwd,
    });
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
