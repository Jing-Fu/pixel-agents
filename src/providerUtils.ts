import * as path from 'path';

export type ProviderId = 'claude' | 'codex';

function normalizeFsPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

export function inferProviderFromJsonlPath(filePath: string): ProviderId {
  const normalized = normalizeFsPath(filePath);
  if (normalized.includes(`${path.sep}.codex${path.sep}`)) {
    return 'codex';
  }
  return 'claude';
}

export function pathsOverlap(a: string, b: string): boolean {
  const left = normalizeFsPath(a);
  const right = normalizeFsPath(b);
  return left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep);
}
