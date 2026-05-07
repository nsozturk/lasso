import type { Channel } from "../types";
import { CloseIcon, DownloadIcon, SyncIcon } from "../icons";

type Props = {
  channel: Channel;
  onToggleAuto: () => void;
  onSync: () => void;
  syncing?: boolean;
  onDownloadAll: () => void;
  pendingCount: number;
  downloadingAll?: boolean;
  onStopAll: () => void;
  inFlightCount: number;
};

export function ChannelHeader({
  channel,
  onToggleAuto,
  onSync,
  syncing,
  onDownloadAll,
  pendingCount,
  downloadingAll,
  onStopAll,
  inFlightCount,
}: Props) {
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
          <h1>
            {channel.name}
            {channel.mode === "audio" ? (
              <span
                className="chip queued"
                style={{ marginLeft: 10, fontSize: 10, verticalAlign: "middle" }}
                title="Audio mode — downloads will be extracted as audio"
              >
                ♪ Audio
              </span>
            ) : null}
          </h1>
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
          <button
            className="btn-primary"
            onClick={onDownloadAll}
            disabled={downloadingAll || pendingCount === 0}
            title={
              pendingCount === 0
                ? "Nothing to download"
                : `Queue ${pendingCount} pending or failed videos`
            }
          >
            <DownloadIcon />
            {downloadingAll
              ? "Queuing…"
              : pendingCount > 0
                ? `Download all (${pendingCount})`
                : "Download all"}
          </button>
          {inFlightCount > 0 ? (
            <button
              className="btn-secondary stop-all"
              onClick={onStopAll}
              title="Cancel every running and queued download"
            >
              <CloseIcon />
              Stop all ({inFlightCount})
            </button>
          ) : null}
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
