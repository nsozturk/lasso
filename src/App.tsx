import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { ChannelHeader } from "./components/ChannelHeader";
import { FilterBar, type Filter } from "./components/FilterBar";
import { VideoCard } from "./components/VideoCard";
import { SkeletonVideoCard } from "./components/SkeletonVideoCard";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { AddChannelSheet, type AddSubmission } from "./components/AddChannelSheet";
import { SettingsSheet } from "./components/SettingsSheet";
import { AudioSettingsSheet } from "./components/AudioSettingsSheet";
import { DownloadAllSheet } from "./components/DownloadAllSheet";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "./components/ContextMenu";
import { useToast } from "./components/Toast";
import { api } from "./api";
import { decorateChannel, decorateVideo, gradientFor } from "./format";
import type {
  Channel,
  DownloadProgress,
  FetchProgress,
  Video,
} from "./types";

const SEED_POLL_MS = 2000;
const SEED_MAX_TRIES = 12;
const VIDEO_POLL_MS = 2500;
const PROGRESS_POLL_MS = 1000;

type PendingAdd = {
  tempId: string;
  url: string;
  displayName: string;
  expected: number;
  mode: "video" | "audio";
};

function pendingTempId(url: string): string {
  return `pending:${url}`;
}

function displayNameFromUrl(url: string): string {
  const m = url.match(/youtube\.com\/(?:@|c\/|channel\/|user\/)?([^/?#]+)/i);
  if (m && m[1]) return m[1].replace(/^@/, "");
  return url.replace(/^https?:\/\//, "").slice(0, 30) || "Loading…";
}

function makePlaceholderChannel(pa: PendingAdd): Channel {
  return {
    id: pa.tempId,
    name: pa.displayName,
    handle: null,
    url: pa.url,
    subscriberCount: null,
    avatarUrl: null,
    autoArchive: false,
    skipShorts: true,
    qualityPref: "1080p",
    formatPref: "mp4",
    mode: pa.mode,
    savePath: "",
    lastSyncedAt: null,
    createdAt: Math.floor(Date.now() / 1000),
    videoCount: 0,
    storageBytes: 0,
    avatarGradient: gradientFor(pa.tempId),
    avatarInitial: (pa.displayName[0] ?? "?").toUpperCase(),
    subscriberLabel: "fetching…",
    storageGB: 0,
    lastSyncLabel: "just now",
    pending: true,
  };
}

export default function App() {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [downloadAllSheetOpen, setDownloadAllSheetOpen] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, DownloadProgress>>({});
  const [fetchMap, setFetchMap] = useState<Record<string, FetchProgress>>({});
  const [syncingChannelIds, setSyncingChannelIds] = useState<Set<string>>(new Set());
  const [bulkDownloadingChannels, setBulkDownloadingChannels] = useState<Set<string>>(new Set());
  const [pendingAdds, setPendingAdds] = useState<Map<string, PendingAdd>>(new Map());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [skipShorts, setSkipShorts] = useState(true);
  const [minDurationMin, setMinDurationMin] = useState(0);

  const refreshChannels = useCallback(async () => {
    try {
      const raw = await api.listChannels();
      const decorated = raw.map(decorateChannel);
      setChannels(decorated);
      setActiveChannelId((prev) => prev ?? decorated[0]?.id ?? null);
      return decorated;
    } catch (e) {
      setBootError(String(e));
      return [];
    }
  }, []);

  // Initial load + poll for first-run seed.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    (async () => {
      const initial = await refreshChannels();
      if (initial.length > 0 || cancelled) return;
      const interval = setInterval(async () => {
        if (cancelled) return clearInterval(interval);
        tries += 1;
        const list = await refreshChannels();
        if (list.length > 0 || tries >= SEED_MAX_TRIES) clearInterval(interval);
      }, SEED_POLL_MS);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshChannels]);

  const refreshVideos = useCallback(async (channelId: string) => {
    try {
      const raw = await api.listVideos(channelId);
      setVideos(raw.map(decorateVideo));
    } catch (e) {
      console.error("list_videos failed", e);
    }
  }, []);

  // Load videos when active channel changes.
  useEffect(() => {
    if (!activeChannelId) {
      setVideos([]);
      return;
    }
    refreshVideos(activeChannelId);
  }, [activeChannelId, refreshVideos]);

  // Poll video list (status changes) while any video is in-flight.
  const hasInFlight = videos.some(
    (v) => v.status === "downloading" || v.status === "queued"
  );
  useEffect(() => {
    if (!activeChannelId || !hasInFlight) return;
    const id = setInterval(() => refreshVideos(activeChannelId), VIDEO_POLL_MS);
    return () => clearInterval(id);
  }, [activeChannelId, hasInFlight, refreshVideos]);

  // Poll progress map (1s) while any download is in-flight.
  useEffect(() => {
    if (!hasInFlight) {
      if (Object.keys(progressMap).length > 0) setProgressMap({});
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await api.getActiveDownloads();
        if (cancelled) return;
        const next: Record<string, DownloadProgress> = {};
        for (const dp of list) next[dp.videoId] = dp;
        setProgressMap(next);
      } catch (e) {
        console.error("get_active_downloads failed", e);
      }
    };
    tick();
    const id = setInterval(tick, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInFlight]);

  // Poll fetch progress (channel video streaming) every 1.5s. Always-on poll
  // so a fetch kicked off in another channel doesn't go unnoticed.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await api.getFetchProgress();
        if (cancelled) return;
        const next: Record<string, FetchProgress> = {};
        for (const fp of list) next[fp.channelId] = fp;
        setFetchMap(next);
      } catch (e) {
        console.error("get_fetch_progress failed", e);
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // While the active channel is fetching, refresh its video list every 1.5s
  // so newly-streamed videos appear without waiting for download polling.
  const activeFetchProgress = activeChannelId ? fetchMap[activeChannelId] : undefined;
  const isActiveFetching = !!activeFetchProgress &&
    activeFetchProgress.fetched < activeFetchProgress.expected;
  useEffect(() => {
    if (!activeChannelId || !isActiveFetching) return;
    const id = setInterval(() => refreshVideos(activeChannelId), 1500);
    return () => clearInterval(id);
  }, [activeChannelId, isActiveFetching, refreshVideos]);

  // When a fetch finishes, refresh the channel list so videoCount updates.
  const fetchKeysCount = Object.keys(fetchMap).length;
  const prevFetchCountRef = useRef(0);
  useEffect(() => {
    if (prevFetchCountRef.current > fetchKeysCount) {
      refreshChannels();
      if (activeChannelId) refreshVideos(activeChannelId);
    }
    prevFetchCountRef.current = fetchKeysCount;
  }, [fetchKeysCount, refreshChannels, refreshVideos, activeChannelId]);

  const handleDownload = useCallback(
    async (videoId: string, audioFormat?: string) => {
      try {
        await api.downloadVideo(videoId, audioFormat);
        if (activeChannelId) refreshVideos(activeChannelId);
      } catch (e) {
        console.error("download_video failed", e);
      }
    },
    [activeChannelId, refreshVideos]
  );

  const handleCancel = useCallback(
    async (videoId: string) => {
      try {
        await api.cancelDownload(videoId);
        if (activeChannelId) refreshVideos(activeChannelId);
      } catch (e) {
        console.error("cancel_download failed", e);
      }
    },
    [activeChannelId, refreshVideos]
  );

  const allChannels = useMemo(() => {
    const placeholders = Array.from(pendingAdds.values()).map(makePlaceholderChannel);
    return [...channels, ...placeholders];
  }, [channels, pendingAdds]);

  const activeChannel = allChannels.find((c) => c.id === activeChannelId) ?? null;
  const isActivePending = !!activeChannel?.pending;

  const handleToggleAuto = useCallback(
    async (id: string) => {
      const target = channels.find((c) => c.id === id);
      if (!target) return;
      const next = !target.autoArchive;
      setChannels((cs) =>
        cs.map((c) => (c.id === id ? { ...c, autoArchive: next } : c))
      );
      try {
        await api.setAutoArchive(id, next);
      } catch (e) {
        console.error("set_auto_archive failed", e);
        setChannels((cs) =>
          cs.map((c) => (c.id === id ? { ...c, autoArchive: !next } : c))
        );
      }
    },
    [channels]
  );

  const handleStopAll = useCallback(async () => {
    try {
      const n = await api.cancelAllDownloads();
      if (activeChannelId) refreshVideos(activeChannelId);
      if (n > 0) toast(`Stopped ${n} download${n > 1 ? "s" : ""}`, "success");
    } catch (e) {
      console.error("cancel_all_downloads failed", e);
      toast("Couldn't stop downloads", "error");
    }
  }, [activeChannelId, refreshVideos, toast]);

  const handleOpenDownloadAll = useCallback(() => {
    if (!activeChannelId) return;
    setDownloadAllSheetOpen(true);
  }, [activeChannelId]);

  const handleDownloadAllConfirm = useCallback(
    async (opts: {
      audioFormat?: string;
      quality?: string;
      format?: string;
    }) => {
      if (!activeChannelId) return;
      setBulkDownloadingChannels((s) => new Set(s).add(activeChannelId));
      try {
        const n = await api.downloadAllPending(activeChannelId, opts);
        await refreshVideos(activeChannelId);
        toast(
          n > 0
            ? `Queued ${n} download${n > 1 ? "s" : ""}`
            : "Nothing to queue",
          n > 0 ? "success" : "info",
        );
      } catch (e) {
        console.error("download_all_pending failed", e);
        toast("Couldn't queue downloads", "error");
      } finally {
        setBulkDownloadingChannels((s) => {
          const next = new Set(s);
          next.delete(activeChannelId);
          return next;
        });
      }
    },
    [activeChannelId, refreshVideos, toast],
  );

  const handleCancelFetch = useCallback(async () => {
    if (!activeChannelId) return;
    try {
      const aborted = await api.cancelChannelFetch(activeChannelId);
      setFetchMap((m) => {
        const next = { ...m };
        delete next[activeChannelId];
        return next;
      });
      if (aborted) toast("Fetch cancelled", "success");
    } catch (e) {
      console.error("cancel_channel_fetch failed", e);
      toast("Couldn't cancel fetch", "error");
    }
  }, [activeChannelId, toast]);

  const handleSync = useCallback(async () => {
    if (!activeChannel) return;
    const id = activeChannel.id;
    if (syncingChannelIds.has(id)) return;
    setSyncingChannelIds((s) => new Set(s).add(id));
    try {
      await api.syncChannel(id);
      await refreshChannels();
      await refreshVideos(id);
    } catch (e) {
      console.error("sync_channel failed", e);
    } finally {
      setSyncingChannelIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }, [activeChannel, refreshChannels, refreshVideos, syncingChannelIds]);

  const handleAddSubmit = useCallback(
    (item: AddSubmission) => {
      const tempId = pendingTempId(item.url);
      const pa: PendingAdd = {
        tempId,
        url: item.url,
        displayName: displayNameFromUrl(item.url),
        expected: item.initial > 0 ? item.initial : 1,
        mode: item.mode,
      };
      setPendingAdds((prev) => {
        const next = new Map(prev);
        next.set(item.url, pa);
        return next;
      });
      setActiveChannelId(tempId);

      api
        .addChannel(
          item.url,
          item.initial,
          item.quality,
          item.format,
          item.skipShorts,
          item.mode,
        )
        .then(async (channel) => {
          // Pull the real channel into the list, drop the placeholder, and if
          // the user is still viewing the placeholder switch to the real id so
          // the skeletons keep flowing into a real channel screen.
          await refreshChannels();
          setPendingAdds((prev) => {
            const next = new Map(prev);
            next.delete(item.url);
            return next;
          });
          setActiveChannelId((prev) => (prev === tempId ? channel.id : prev));
          toast(`Added “${channel.name}”`, "success");
        })
        .catch((e) => {
          const msg = String(e).replace(/^Error: /, "");
          console.error("addChannel failed", msg);
          setPendingAdds((prev) => {
            const next = new Map(prev);
            next.delete(item.url);
            return next;
          });
          // If the active view was this placeholder, fall back to the first
          // real channel (or null) so the user is not stuck on a dead screen.
          setActiveChannelId((prev) =>
            prev === tempId ? (channels[0]?.id ?? null) : prev,
          );
          toast(msg, "error");
        });
    },
    [refreshChannels, channels, toast],
  );

  const handleDeleteChannel = useCallback((id: string) => {
    setPendingDelete(id);
  }, []);

  const confirmDeleteChannel = useCallback(async () => {
    const id = pendingDelete;
    if (!id) return;
    setPendingDelete(null);
    const ch = channels.find((c) => c.id === id);
    const name = ch?.name ?? "this channel";
    try {
      await api.deleteChannel(id, false);
      if (activeChannelId === id) {
        setActiveChannelId(null);
      }
      await refreshChannels();
      toast(`Removed “${name}”`, "success");
    } catch (e) {
      console.error("delete_channel failed", e);
      toast("Couldn't remove channel", "error");
    }
  }, [pendingDelete, channels, activeChannelId, refreshChannels, toast]);

  const showInFinder = useCallback(
    async (path: string) => {
      try {
        await api.showInFinder(path);
      } catch (e) {
        const msg = String(e).replace(/^Error: /, "");
        toast(msg, "error");
      }
    },
    [toast],
  );

  const openChannelContextMenu = useCallback(
    (e: ReactMouseEvent, channel: Channel) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [
        {
          label: "Show in Finder",
          disabled: !channel.savePath || channel.pending,
          onClick: () => showInFinder(channel.savePath),
        },
        {
          label: "Remove channel",
          danger: true,
          disabled: !!channel.pending,
          onClick: () => handleDeleteChannel(channel.id),
        },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [showInFinder, handleDeleteChannel],
  );

  const openVideoContextMenu = useCallback(
    (e: ReactMouseEvent, video: Video) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [
        {
          label: "Show in Finder",
          disabled: !video.filePath,
          onClick: () => video.filePath && showInFinder(video.filePath),
        },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [showInFinder],
  );

  // Derived: filtered video list.
  const displayedVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minSec = minDurationMin * 60;
    return videos.filter((v) => {
      if (q && !v.title.toLowerCase().includes(q)) return false;
      if (filter === "Saved" && v.status !== "downloaded") return false;
      if (filter === "New" && v.status !== "pending") return false;
      if (skipShorts && v.isShort) return false;
      if (minSec > 0 && (v.durationSeconds ?? 0) < minSec) return false;
      return true;
    });
  }, [videos, searchQuery, filter, skipShorts, minDurationMin]);

  const newCount = useMemo(
    () => videos.filter((v) => v.status === "pending").length,
    [videos]
  );

  const isActiveSyncing = activeChannel
    ? syncingChannelIds.has(activeChannel.id)
    : false;

  const isActiveBulkDownloading = activeChannel
    ? bulkDownloadingChannels.has(activeChannel.id)
    : false;

  const pendingOrFailedCount = useMemo(
    () =>
      videos.filter((v) => v.status === "pending" || v.status === "failed")
        .length,
    [videos]
  );

  const inFlightCount = useMemo(
    () =>
      videos.filter(
        (v) => v.status === "downloading" || v.status === "queued"
      ).length,
    [videos]
  );

  return (
    <div className="app">
      <Sidebar
        channels={allChannels}
        activeChannelId={activeChannelId ?? ""}
        onSelectChannel={setActiveChannelId}
        onToggleAuto={handleToggleAuto}
        onAddChannel={() => setSheetOpen(true)}
        onDeleteChannel={handleDeleteChannel}
        onChannelContextMenu={openChannelContextMenu}
      />

      <main className="content">
        <div className="titlebar-spacer" data-tauri-drag-region />
        <Toolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenActivity={() => setDrawerOpen(true)}
          onOpenAudioSettings={() => setAudioSettingsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="main-scroll">
          {!activeChannel ? (
            <EmptyState
              error={bootError}
              onAddChannel={() => setSheetOpen(true)}
            />
          ) : isActivePending ? (
            <PendingChannelView
              channel={activeChannel}
              expected={
                pendingAdds.get(activeChannel.url)?.expected ?? 12
              }
            />
          ) : (
            <>
              <ChannelHeader
                channel={activeChannel}
                onToggleAuto={() => handleToggleAuto(activeChannel.id)}
                onSync={handleSync}
                syncing={isActiveSyncing}
                onDownloadAll={handleOpenDownloadAll}
                pendingCount={pendingOrFailedCount}
                downloadingAll={isActiveBulkDownloading}
                onStopAll={handleStopAll}
                inFlightCount={inFlightCount}
                fetching={isActiveFetching}
                onCancelFetch={handleCancelFetch}
              />
              <FilterBar
                filter={filter}
                onFilterChange={setFilter}
                skipShorts={skipShorts}
                onSkipShortsChange={setSkipShorts}
                minDurationMin={minDurationMin}
                onMinDurationChange={setMinDurationMin}
                newCount={newCount}
              />
              <ul className="video-list">
                {displayedVideos.length === 0 && !isActiveFetching ? (
                  <li
                    style={{
                      padding: "32px 12px",
                      color: "var(--text-tertiary)",
                      fontSize: 13,
                    }}
                  >
                    {videos.length === 0
                      ? "No videos found for this channel yet."
                      : "No videos match the current filters."}
                  </li>
                ) : (
                  <>
                    {displayedVideos.map((v) => (
                      <VideoCard
                        key={v.id}
                        video={v}
                        progress={progressMap[v.id]}
                        onDownload={handleDownload}
                        onCancel={handleCancel}
                        onContextMenu={openVideoContextMenu}
                      />
                    ))}
                    {isActiveFetching && activeFetchProgress
                      ? Array.from({
                          length: Math.max(
                            0,
                            Math.min(
                              activeFetchProgress.expected -
                                activeFetchProgress.fetched,
                              50,
                            ),
                          ),
                        }).map((_, i) => (
                          <SkeletonVideoCard key={`skeleton-${i}`} />
                        ))
                      : null}
                  </>
                )}
              </ul>
            </>
          )}
        </div>
      </main>

      <ActivityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <AddChannelSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleAddSubmit}
        existingUrls={channels.map((c) => c.url)}
      />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <AudioSettingsSheet
        open={audioSettingsOpen}
        onClose={() => setAudioSettingsOpen(false)}
      />
      <DownloadAllSheet
        open={downloadAllSheetOpen}
        channelName={activeChannel?.name ?? ""}
        pendingCount={pendingOrFailedCount}
        onClose={() => setDownloadAllSheetOpen(false)}
        onConfirm={handleDownloadAllConfirm}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove channel"
        message={
          pendingDelete
            ? `Remove “${
                channels.find((c) => c.id === pendingDelete)?.name ?? "this channel"
              }” from your library? Downloaded files on disk are kept.`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDeleteChannel}
        onCancel={() => setPendingDelete(null)}
      />
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}

function PendingChannelView({
  channel,
  expected,
}: {
  channel: Channel;
  expected: number;
}) {
  const skeletonCount = Math.min(Math.max(expected, 5), 25);
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
          <div className="ch-meta">Fetching channel info from YouTube…</div>
        </div>
      </article>
      <ul className="video-list">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <SkeletonVideoCard key={`pending-skeleton-${i}`} />
        ))}
      </ul>
    </>
  );
}

function EmptyState({
  error,
  onAddChannel,
}: {
  error: string | null;
  onAddChannel: () => void;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
        padding: 48,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: "linear-gradient(135deg, #6CC5F0 0%, #4373D9 60%, #1E3F8C 100%)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 36,
          fontWeight: 600,
          marginBottom: 8,
          boxShadow: "0 18px 40px rgba(30,63,140,.32)",
        }}
      >
        L
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 600 }}>
        {error ? "Couldn't load channels" : "Setting up your library…"}
      </h2>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 360 }}>
        {error
          ? error
          : "Lasso is fetching your default channel from YouTube. This usually takes a few seconds on first launch."}
      </p>
      <button className="btn-primary" onClick={onAddChannel} style={{ marginTop: 8 }}>
        + Add a channel manually
      </button>
    </div>
  );
}
