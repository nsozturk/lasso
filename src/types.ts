// Mirror of Rust backend types (camelCase via serde rename_all).
export type ApiChannel = {
  id: string;
  name: string;
  handle: string | null;
  url: string;
  subscriberCount: number | null;
  avatarUrl: string | null;
  autoArchive: boolean;
  skipShorts: boolean;
  qualityPref: string;
  formatPref: string;
  mode: "video" | "audio";
  savePath: string;
  lastSyncedAt: number | null;
  createdAt: number;
  videoCount: number;
  storageBytes: number;
};

export type DownloadProgress = {
  videoId: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number | null;
  etaSeconds: number | null;
};

export type FetchProgress = {
  channelId: string;
  fetched: number;
  expected: number;
};

export type Settings = Record<string, string>;

export type ApiVideo = {
  id: string;
  channelId: string;
  title: string;
  durationSeconds: number | null;
  uploadDate: string | null;
  viewCount: number | null;
  thumbnailUrl: string | null;
  isShort: boolean;
  status: VideoStatus;
  filePath: string | null;
  fileSizeBytes: number | null;
  createdAt: number;
};

export type VideoStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "downloaded"
  | "skipped"
  | "failed"
  | "paused";

// Display-decorated versions (with derived fields used by UI components).
export type Channel = ApiChannel & {
  avatarGradient: string;
  avatarInitial: string;
  subscriberLabel: string;
  storageGB: number;
  lastSyncLabel: string;
  unread?: number;
  syncing?: boolean;
  /** When true this is a frontend-only placeholder while metadata is being
   * fetched from yt-dlp. UI hides downloads/sync controls and renders
   * skeletons. */
  pending?: boolean;
};

export type Video = ApiVideo & {
  duration: string;
  postedRelative: string;
  views?: string;
  thumbClass: string;
  isNew?: boolean;
  metaLine: string;
};
