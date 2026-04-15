import type * as vscode from 'vscode';

import type { ProviderId } from './providerUtils.js';

export interface PendingTerminalLaunch {
  agentId: number;
  providerId: ProviderId;
  terminal: vscode.Terminal;
  cwd: string;
  folderName?: string;
  launchedAt: number;
}

const pendingTerminalLaunches = new Map<number, PendingTerminalLaunch>();

export function registerPendingTerminalLaunch(launch: PendingTerminalLaunch): void {
  pendingTerminalLaunches.set(launch.agentId, launch);
}

export function removePendingTerminalLaunch(agentId: number): void {
  pendingTerminalLaunches.delete(agentId);
}

export function listPendingTerminalLaunches(): PendingTerminalLaunch[] {
  return [...pendingTerminalLaunches.values()];
}
