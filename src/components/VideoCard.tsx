import type { DownloadProgress, Video, VideoStatus } from "../types";
import { CheckIcon, DownloadIcon } from "../icons";
import { formatBytes, formatSpeed } from "../format";

function StatusChip({ status }: { status: VideoStatus }) {
  switch (status) {
    case "downloaded":
      return (
        <span className="chip success">
          <CheckIcon />
          Downloaded
        </span>
      );
    case "queued":
      return (
        <span className="chip queued">
          <DownloadIcon />
          Queued
        </span>
      );
    case "downloading":
      return (
        <span className="chip queued">
          <DownloadIcon />
          Starting…
        </span>
      );
    case "skipped":
      return <span className="chip skip">◌ Skipped</span>;
    case "paused":
      return <span className="chip paused">⏸ Paused</span>;
    case "failed":
      return <span className="chip skip">⚠ Failed</span>;
    case "pending":
      return null;
  }
}

type Props = {
  video: Video;
  progress?: DownloadProgress;
  onDownload?: (id: string) => void;
};

export function VideoCard({ video, progress, onDownload }: Props) {
  const canDownload =
    onDownload && (video.status === "pending" || video.status === "failed");

  const isDownloading = video.status === "downloading";
  const showProgress = isDownloading && progress;

  const percent = progress
    ? Math.min(100, Math.max(0, progress.percent))
    : 0;
  const progressMeta = showProgress
    ? [
        progress.totalBytes > 0
          ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
          : formatBytes(progress.downloadedBytes),
        formatSpeed(progress.speedBps),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <li className="video-card">
      <div className={`thumb ${video.thumbClass}`}>
        {video.isNew ? <span className="new-tag">New</span> : null}
        <span className="duration">{video.duration}</span>
      </div>
      <div className="video-info">
        <div className="title">{video.title}</div>
        <div className="meta">
          {video.postedRelative ? <span>{video.postedRelative}</span> : null}
          {video.views ? (
            <>
              {video.postedRelative ? <span className="dot">·</span> : null}
              <span>{video.views}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="video-status">
        {canDownload ? (
          <button
            className="chip queued chip-button"
            onClick={() => onDownload(video.id)}
          >
            <DownloadIcon />
            Download
          </button>
        ) : showProgress ? (
          <span className="chip queued">
            <DownloadIcon />
            {Math.round(percent)}%
          </span>
        ) : (
          <StatusChip status={video.status} />
        )}
        <span className="meta-line">
          {progressMeta ?? video.metaLine}
        </span>
      </div>
      {isDownloading ? (
        <div className="progress-bar">
          <div className="fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </li>
  );
}
