import { invoke } from "@tauri-apps/api/core";
import type {
  ApiChannel,
  ApiVideo,
  DownloadProgress,
  Settings,
} from "./types";

export const api = {
  listChannels: () => invoke<ApiChannel[]>("list_channels"),

  listVideos: (channelId: string) =>
    invoke<ApiVideo[]>("list_videos", { channelId }),

  fetchChannelPreview: (url: string) =>
    invoke<{
      id: string;
      name: string;
      handle: string | null;
      url: string;
      subscriberCount: number | null;
      avatarUrl: string | null;
    }>("fetch_channel_preview", { url }),

  addChannel: (
    url: string,
    initialVideoCount?: number,
    quality?: string,
    format?: string,
    skipShorts?: boolean,
    mode?: "video" | "audio",
  ) =>
    invoke<ApiChannel>("add_channel", {
      url,
      initialVideoCount,
      quality,
      format,
      skipShorts,
      mode,
    }),

  syncChannel: (channelId: string, maxVideos?: number) =>
    invoke<number>("sync_channel", { channelId, maxVideos }),

  setAutoArchive: (channelId: string, enabled: boolean) =>
    invoke<void>("set_auto_archive", { channelId, enabled }),

  downloadVideo: (videoId: string, audioFormat?: string) =>
    invoke<void>("download_video", { videoId, audioFormat }),

  downloadAllPending: (
    channelId: string,
    opts?: { audioFormat?: string; quality?: string; format?: string },
  ) =>
    invoke<number>("download_all_pending", {
      channelId,
      audioFormat: opts?.audioFormat,
      quality: opts?.quality,
      format: opts?.format,
    }),

  cancelDownload: (videoId: string) =>
    invoke<string>("cancel_download", { videoId }),

  cancelAllDownloads: () => invoke<number>("cancel_all_downloads"),

  getActiveDownloads: () =>
    invoke<DownloadProgress[]>("get_active_downloads"),

  getSettings: () => invoke<Settings>("get_settings"),

  updateSettings: (patch: Settings) =>
    invoke<void>("update_settings", { patch }),
};
