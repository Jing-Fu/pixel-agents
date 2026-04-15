import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { copyCopilotHookScript, installCopilotHooks, uninstallCopilotHooks } =
  await import('../src/providers/file/copilotHookInstaller.js');

describe('copilotHookInstaller', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-copilot-hook-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('installCopilotHooks writes a repo-level hooks file', () => {
    const workspacePath = path.join(tmpBase, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });

    installCopilotHooks(workspacePath);

    const hookPath = path.join(workspacePath, '.github', 'hooks', 'pixel-agents.json');
    expect(fs.existsSync(hookPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(hookPath, 'utf-8')) as {
      version: number;
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart).toHaveLength(1);
    expect(config.hooks.preToolUse).toHaveLength(1);
  });

  it('uninstallCopilotHooks removes the repo-level hooks file', () => {
    const workspacePath = path.join(tmpBase, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });

    installCopilotHooks(workspacePath);
    uninstallCopilotHooks(workspacePath);

    const hookPath = path.join(workspacePath, '.github', 'hooks', 'pixel-agents.json');
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('copyCopilotHookScript copies to ~/.pixel-agents/hooks/', () => {
    const mockExtPath = path.join(tmpBase, 'mock-ext');
    const hookSrc = path.join(mockExtPath, 'dist', 'hooks');
    fs.mkdirSync(hookSrc, { recursive: true });
    fs.writeFileSync(path.join(hookSrc, 'copilot-hook.js'), '// mock copilot hook script');

    copyCopilotHookScript(mockExtPath);

    const dst = path.join(tmpBase, '.pixel-agents', 'hooks', 'copilot-hook.js');
    expect(fs.existsSync(dst)).toBe(true);
    expect(fs.readFileSync(dst, 'utf-8')).toBe('// mock copilot hook script');
  });
});
