import type * as vscode from 'vscode';

export interface PendingCodexLaunch {
  agentId: number;
  terminal: vscode.Terminal;
  cwd: string;
  folderName?: string;
  launchedAt: number;
}

const pendingCodexLaunches = new Map<number, PendingCodexLaunch>();

export function registerPendingCodexLaunch(launch: PendingCodexLaunch): void {
  pendingCodexLaunches.set(launch.agentId, launch);
}

export function removePendingCodexLaunch(agentId: number): void {
  pendingCodexLaunches.delete(agentId);
}

export function listPendingCodexLaunches(): PendingCodexLaunch[] {
  return [...pendingCodexLaunches.values()];
}
