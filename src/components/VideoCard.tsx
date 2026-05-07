import { useEffect, useRef, useState } from "react";
import type { DownloadProgress, Video, VideoStatus } from "../types";
import { CheckIcon, DownloadIcon, KebabIcon } from "../icons";
import { formatBytes, formatSpeed } from "../format";

const AUDIO_FORMATS: { value: string; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "flac", label: "FLAC (lossless)" },
  { value: "opus", label: "OPUS" },
  { value: "wav", label: "WAV (lossless)" },
  { value: "ogg", label: "OGG (Vorbis)" },
  { value: "aac", label: "AAC" },
  { value: "alac", label: "ALAC (lossless)" },
];

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
  onDownload?: (id: string, audioFormat?: string) => void;
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

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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

      {onDownload ? (
        <div className="video-kebab" ref={menuRef}>
          <button
            className="kebab-btn"
            title="More download options"
            aria-label="More download options"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <KebabIcon />
          </button>
          {menuOpen ? (
            <div className="kebab-menu" role="menu">
              <button
                className="kebab-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  onDownload(video.id);
                }}
              >
                Download as Video (channel default)
              </button>
              <div className="kebab-menu-section">Audio extraction</div>
              {AUDIO_FORMATS.map((f) => (
                <button
                  key={f.value}
                  className="kebab-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload(video.id, f.value);
                  }}
                >
                  Download as {f.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {isDownloading ? (
        <div className="progress-bar">
          <div className="fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </li>
  );
}
