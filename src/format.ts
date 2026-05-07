import type { ApiChannel, ApiVideo, Channel, Video, VideoStatus } from "./types";

const GRADIENTS = [
  "linear-gradient(135deg, #6CC5F0, #4373D9)",
  "linear-gradient(135deg, #FFB3B3, #FF6B6B)",
  "linear-gradient(135deg, #BBA0FF, #7C5CE6)",
  "linear-gradient(135deg, #FFD27A, #FF8C42)",
  "linear-gradient(135deg, #A8E6A1, #3DAA52)",
  "linear-gradient(135deg, #7AD4F0, #3FA9D8)",
  "linear-gradient(135deg, #F0A8C5, #D846A0)",
  "linear-gradient(135deg, #FFE08A, #F2A93B)",
];

const THUMB_CLASSES = ["veri-1", "veri-2", "veri-3", "veri-4", "veri-5", "veri-6"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function gradientFor(id: string): string {
  return GRADIENTS[hashString(id) % GRADIENTS.length];
}

export function thumbClassFor(id: string): string {
  return THUMB_CLASSES[hashString(id) % THUMB_CLASSES.length];
}

export function formatSubscribers(n: number | null): string {
  if (n == null) return "subscribers unknown";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M subscribers`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K subscribers`;
  return `${n} subscribers`;
}

export function formatBytesGB(bytes: number): number {
  return Math.round((bytes / 1e9) * 10) / 10;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSpeed(bps: number | null): string {
  if (!bps || bps <= 0) return "";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatRelative(epochSec: number | null): string {
  if (!epochSec) return "never";
  const now = Date.now() / 1000;
  const diff = now - epochSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(epochSec * 1000).toLocaleDateString();
}

function statusMeta(v: ApiVideo): string {
  switch (v.status) {
    case "downloaded":
      return v.fileSizeBytes
        ? `1080p · ${(v.fileSizeBytes / 1e6).toFixed(0)} MB`
        : "downloaded";
    case "queued":
      return "Auto · 1080p";
    case "skipped":
      return v.isShort ? "Short blocked by rule" : "skipped";
    case "paused":
      return "waiting";
    case "downloading":
      return "in progress";
    case "failed":
      return "tap to retry";
    default:
      return "pending sync";
  }
}

export function decorateChannel(c: ApiChannel): Channel {
  return {
    ...c,
    avatarGradient: gradientFor(c.id),
    avatarInitial: (c.name[0] || "?").toUpperCase(),
    subscriberLabel: formatSubscribers(c.subscriberCount),
    storageGB: formatBytesGB(c.storageBytes),
    lastSyncLabel: formatRelative(c.lastSyncedAt),
  };
}

export function decorateVideo(v: ApiVideo): Video {
  // "isNew" — uploaded in last 7 days (we don't have upload_date yet, so use createdAt)
  const isNewByCreated = Date.now() / 1000 - v.createdAt < 86400 * 7;
  return {
    ...v,
    duration: formatDuration(v.durationSeconds),
    postedRelative: v.uploadDate ?? "",
    views: v.viewCount ? `${formatCount(v.viewCount)} views` : undefined,
    thumbClass: thumbClassFor(v.id),
    isNew: isNewByCreated && v.status === "pending",
    metaLine: statusMeta(v),
  };
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${n}`;
}

export const STATUS_CHIP_LABEL: Record<VideoStatus, string | null> = {
  pending: null,
  queued: "Queued",
  downloading: "Downloading",
  downloaded: "Downloaded",
  skipped: "Skipped",
  paused: "Paused",
  failed: "Failed",
};
