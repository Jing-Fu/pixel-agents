import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { COPILOT_HOOK_SCRIPT_NAME, HOOK_SCRIPTS_DIR } from '../../constants.js';

const COPILOT_HOOK_FILE_NAME = 'pixel-agents.json';
const COPILOT_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'preToolUse',
  'postToolUse',
  'errorOccurred',
] as const;

interface CopilotCommandHook {
  type: 'command';
  bash: string;
  powershell: string;
  cwd?: string;
  timeoutSec?: number;
}

interface CopilotHooksConfig {
  version: 1;
  hooks: Partial<Record<(typeof COPILOT_HOOK_EVENTS)[number], CopilotCommandHook[]>>;
}

function getHookScriptPath(): string {
  return path.join(os.homedir(), HOOK_SCRIPTS_DIR, COPILOT_HOOK_SCRIPT_NAME);
}

function getWorkspaceHooksDir(workspacePath: string): string {
  return path.join(workspacePath, '.github', 'hooks');
}

function getWorkspaceHooksConfigPath(workspacePath: string): string {
  return path.join(getWorkspaceHooksDir(workspacePath), COPILOT_HOOK_FILE_NAME);
}

function makeCommand(eventName: string): CopilotCommandHook {
  const scriptPath = getHookScriptPath();
  return {
    type: 'command',
    bash: `node "${scriptPath}" ${eventName}`,
    powershell: `node "${scriptPath}" ${eventName}`,
    cwd: '.',
    timeoutSec: 5,
  };
}

function makeHooksConfig(): CopilotHooksConfig {
  return {
    version: 1,
    hooks: Object.fromEntries(
      COPILOT_HOOK_EVENTS.map((eventName) => [eventName, [makeCommand(eventName)]]),
    ) as CopilotHooksConfig['hooks'],
  };
}

export function installCopilotHooks(workspacePath: string): void {
  const hooksDir = getWorkspaceHooksDir(workspacePath);
  const hooksConfigPath = getWorkspaceHooksConfigPath(workspacePath);

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hooksConfigPath, JSON.stringify(makeHooksConfig(), null, 2) + '\n', 'utf-8');
    console.log(`[Pixel Agents] Copilot hooks installed at ${hooksConfigPath}`);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to install Copilot hooks in ${workspacePath}: ${e}`);
  }
}

export function uninstallCopilotHooks(workspacePath: string): void {
  const hooksConfigPath = getWorkspaceHooksConfigPath(workspacePath);
  try {
    if (fs.existsSync(hooksConfigPath)) {
      fs.unlinkSync(hooksConfigPath);
      console.log(`[Pixel Agents] Copilot hooks removed from ${hooksConfigPath}`);
    }
  } catch (e) {
    console.error(`[Pixel Agents] Failed to remove Copilot hooks in ${workspacePath}: ${e}`);
  }
}

export function copyCopilotHookScript(extensionPath: string): void {
  const src = path.join(extensionPath, 'dist', 'hooks', COPILOT_HOOK_SCRIPT_NAME);
  const dst = getHookScriptPath();
  const dstDir = path.dirname(dst);

  try {
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(src)) {
      console.warn(`[Pixel Agents] Copilot hook script not found at ${src}`);
      return;
    }
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o700);
    console.log(`[Pixel Agents] Copilot hook script installed at ${dst}`);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to copy Copilot hook script: ${e}`);
  }
}
