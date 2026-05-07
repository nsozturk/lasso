import type { Channel } from "../types";
import { SyncIcon } from "../icons";

type Props = {
  channel: Channel;
  onToggleAuto: () => void;
  onSync: () => void;
  syncing?: boolean;
};

export function ChannelHeader({ channel, onToggleAuto, onSync, syncing }: Props) {
  return (
    <>
      <article className="channel-header">
        <div
          className="ch-avatar"
          style={{ background: channel.avatarGradient }}
        >
          {channel.avatarInitial}
        </div>
        <div className="ch-info">
          <h1>{channel.name}</h1>
          <div className="ch-meta">
            {channel.handle} · {channel.subscriberLabel}
          </div>
        </div>
        <div className="ch-actions">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={channel.autoArchive}
              onChange={onToggleAuto}
            />
            <span className="switch" />
            <span>Auto-archive</span>
          </label>
          <button
            className="btn-secondary"
            onClick={onSync}
            disabled={syncing}
          >
            <SyncIcon />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </article>

      <div className="ch-stats">
        <span>{channel.videoCount} videos</span>
        <span className="dot">·</span>
        <span>{channel.storageGB} GB on disk</span>
        <span className="dot">·</span>
        <span>last sync {channel.lastSyncLabel}</span>
      </div>
    </>
  );
}
