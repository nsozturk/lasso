import type { MouseEvent as ReactMouseEvent } from "react";
import type { Channel } from "../types";
import {
  PlusIcon,
  GridIcon,
  ClockSmallIcon,
  DownloadsBoxIcon,
  CloseIcon,
} from "../icons";

type Props = {
  channels: Channel[];
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  onToggleAuto: (id: string) => void;
  onAddChannel: () => void;
  onDeleteChannel: (id: string) => void;
  onChannelContextMenu?: (e: ReactMouseEvent, c: Channel) => void;
};

export function Sidebar({
  channels,
  activeChannelId,
  onSelectChannel,
  onToggleAuto,
  onAddChannel,
  onDeleteChannel,
  onChannelContextMenu,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="titlebar-spacer" data-tauri-drag-region />

      <div className="sidebar-toolbar">
        <button className="btn-primary" onClick={onAddChannel}>
          <PlusIcon width={14} height={14} />
          Add Channel
        </button>
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <h3>Library</h3>
          <a className="nav-item">
            <GridIcon className="icon" />
            <span style={{ flex: 1 }}>All Videos</span>
            <span className="count">1,248</span>
          </a>
          <a className="nav-item">
            <ClockSmallIcon className="icon" />
            <span style={{ flex: 1 }}>Recently Added</span>
          </a>
          <a className="nav-item">
            <DownloadsBoxIcon className="icon" />
            <span style={{ flex: 1 }}>Downloads</span>
            <span className="count">4</span>
          </a>
        </section>

        <section className="sidebar-section">
          <h3>
            Channels{" "}
            <button className="add-btn" onClick={onAddChannel} title="Add channel">
              +
            </button>
          </h3>
          {channels.map((c) => (
            <a
              key={c.id}
              className={`channel-item${c.id === activeChannelId ? " active" : ""}${c.pending ? " pending" : ""}`}
              onClick={() => onSelectChannel(c.id)}
              onContextMenu={(e) => onChannelContextMenu?.(e, c)}
            >
              <span className="avatar" style={{ background: c.avatarGradient }} />
              <span className="name">{c.name}</span>
              {c.pending ? (
                <span className="syncing-dot" title="Fetching channel…" />
              ) : null}
              {c.unread ? <span className="badge unread">{c.unread}</span> : null}
              {c.syncing ? <span className="syncing-dot" title="Syncing" /> : null}
              {c.pending ? null : (
                <button
                  className="channel-delete-btn"
                  title="Remove channel"
                  aria-label="Remove channel"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChannel(c.id);
                  }}
                >
                  <CloseIcon />
                </button>
              )}
              <span
                className={`auto${c.autoArchive ? " on" : ""}`}
                title={c.autoArchive ? "Auto-archive on" : "Auto-archive off"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!c.pending) onToggleAuto(c.id);
                }}
                style={c.pending ? { opacity: 0.3, pointerEvents: "none" } : undefined}
              />
            </a>
          ))}
        </section>
      </div>

      <div className="sidebar-footer">
        <div className="storage">
          <div className="label">
            <span>Storage</span>
            <span>23%</span>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: "23%" }} />
          </div>
          <div className="meta">41.2 GB used on Macintosh HD</div>
        </div>
      </div>
    </aside>
  );
}
