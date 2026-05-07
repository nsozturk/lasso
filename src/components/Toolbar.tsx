import { ClockIcon, SettingsIcon } from "../icons";

type Props = {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenActivity: () => void;
  onOpenSettings: () => void;
};

export function Toolbar({
  searchQuery,
  onSearchChange,
  onOpenActivity,
  onOpenSettings,
}: Props) {
  return (
    <div className="toolbar" data-tauri-drag-region>
      <input
        className="search"
        placeholder="Search videos…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="spacer" />
      <button className="btn-icon" title="Activity" onClick={onOpenActivity}>
        <ClockIcon />
      </button>
      <button className="btn-icon" title="Settings" onClick={onOpenSettings}>
        <SettingsIcon />
      </button>
    </div>
  );
}
