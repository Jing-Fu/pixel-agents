import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
}: BottomToolbarProps) {
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingLaunchRef = useRef<{ provider: 'codex' | 'copilot'; bypassPermissions: boolean }>({
    provider: 'codex',
    bypassPermissions: false,
  });

  // Close menus on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isAgentMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsAgentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isAgentMenuOpen, isFolderPickerOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsFolderPickerOpen(false);
    setIsAgentMenuOpen((v) => !v);
  };

  const launchAgent = (provider: 'codex' | 'copilot', bypassPermissions = false) => {
    setIsAgentMenuOpen(false);
    if (hasMultipleFolders) {
      pendingLaunchRef.current = { provider, bypassPermissions };
      setIsFolderPickerOpen(true);
      return;
    }
    vscode.postMessage({ type: 'openAgent', provider, bypassPermissions });
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const pendingLaunch = pendingLaunchRef.current;
    pendingLaunchRef.current = { provider: 'codex', bypassPermissions: false };
    vscode.postMessage({
      type: 'openAgent',
      provider: pendingLaunch.provider,
      folderPath: folder.path,
      bypassPermissions: pendingLaunch.bypassPermissions,
    });
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div ref={folderPickerRef} className="relative">
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isAgentMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isAgentMenuOpen} className="min-w-144">
          <DropdownItem onClick={() => launchAgent('codex')} className="text-base">
            Launch Codex
          </DropdownItem>
          <DropdownItem onClick={() => launchAgent('copilot')} className="text-base">
            Launch Copilot CLI
          </DropdownItem>
          <DropdownItem onClick={() => launchAgent('codex', true)} className="text-base">
            Launch Codex <span className="text-2xs text-warning">Skip permissions mode</span>
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
