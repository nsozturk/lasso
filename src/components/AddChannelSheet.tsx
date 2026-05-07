import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";
import { CloseIcon, PlusIcon } from "../icons";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: (channelId: string) => void;
  existingUrls: string[];
};

type GrabMode = "now-on" | "last-n" | "full";
type ChannelMode = "video" | "audio";

function normalizeUrl(u: string): string {
  return u
    .trim()
    .replace(/\/$/, "")
    .replace(/\/(videos|shorts|streams|playlists|community|about|featured)$/i, "")
    .toLowerCase();
}

export function AddChannelSheet({ open, onClose, onAdded, existingUrls }: Props) {
  const { toast } = useToast();
  const [urls, setUrls] = useState<string[]>([""]);
  const [grabMode, setGrabMode] = useState<GrabMode>("now-on");
  const [lastN, setLastN] = useState<number>(25);
  const [quality, setQuality] = useState<string>("1080p");
  const [format, setFormat] = useState<string>("mp4");
  const [mode, setMode] = useState<ChannelMode>("video");
  const [skipShorts, setSkipShorts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getSettings();
        if (cancelled) return;
        if (s.default_quality) setQuality(s.default_quality);
        if (s.default_format) setFormat(s.default_format);
        if (s.default_backlog) setLastN(Number(s.default_backlog) || 25);
        if (s.skip_shorts_default !== undefined)
          setSkipShorts(s.skip_shorts_default === "1");
      } catch (e) {
        console.error("getSettings failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setUrls([""]);
    setGrabMode("now-on");
    setMode("video");
    setError(null);
  }

  function updateUrl(i: number, value: string) {
    setUrls((prev) => prev.map((u, idx) => (idx === i ? value : u)));
  }
  function addRow() {
    setUrls((prev) => [...prev, ""]);
  }
  function removeRow(i: number) {
    setUrls((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit() {
    if (submitting) return;
    const trimmed = urls.map((u) => u.trim()).filter((u) => u.length > 0);
    if (trimmed.length === 0) {
      setError("Paste at least one channel URL");
      return;
    }

    // Local duplicate check (case-insensitive, handles trailing slash + tab
    // suffix variants). Backend has its own check for race conditions.
    const existingNorm = new Set(existingUrls.map(normalizeUrl));
    const localDupes = trimmed.filter((u) => existingNorm.has(normalizeUrl(u)));
    if (localDupes.length > 0) {
      setError(
        `Already in your library: ${localDupes
          .map((u) => u.replace(/^https?:\/\//, ""))
          .join(", ")}`,
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    const initial =
      grabMode === "now-on" ? 0 : grabMode === "last-n" ? lastN : 1000;

    // Fire-and-forget. Sheet closes immediately so the user can navigate.
    // Each promise updates the UI when its metadata pass + first video land.
    for (const url of trimmed) {
      api
        .addChannel(url, initial, quality, format, skipShorts, mode)
        .then((channel) => {
          onAdded(channel.id);
          toast(`Added “${channel.name}”`, "success");
        })
        .catch((e) => {
          const msg = String(e);
          console.error("addChannel failed", msg);
          toast(msg.replace(/^Error: /, ""), "error");
        });
    }

    if (trimmed.length > 1) {
      toast(`Adding ${trimmed.length} channels…`, "info");
    }
    reset();
    onClose();
    setSubmitting(false);
  }

  const realUrlCount = urls.filter((u) => u.trim().length > 0).length;
  const submitLabel = (() => {
    if (submitting) return "Starting…";
    if (realUrlCount <= 1) return "Add channel";
    return `Add channels (${realUrlCount})`;
  })();

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " open" : ""}`}
        onClick={() => !submitting && onClose()}
      />
      <div className={`sheet${open ? " open" : ""}`}>
        <h2>Add a channel to your library</h2>
        <div className="sheet-body">
          {urls.map((u, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}
            >
              <input
                className="sheet-input"
                style={{ flex: 1, marginBottom: 0 }}
                type="text"
                placeholder="https://youtube.com/@channelname"
                value={u}
                onChange={(e) => updateUrl(i, e.target.value)}
                autoFocus={i === urls.length - 1 && open}
                disabled={submitting}
              />
              {urls.length > 1 ? (
                <button
                  className="cancel-btn"
                  type="button"
                  title="Remove this URL"
                  aria-label="Remove this URL"
                  onClick={() => removeRow(i)}
                  disabled={submitting}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="add-row-btn"
            onClick={addRow}
            disabled={submitting}
          >
            <PlusIcon width={11} height={11} />
            Add another channel
          </button>

          <div className="field-label">What should we grab?</div>
          <div className="radio-group">
            <label
              className={`radio-row${grabMode === "now-on" ? " selected" : ""}`}
              onClick={() => setGrabMode("now-on")}
            >
              <span className="radio" />
              <span>From now on</span>
              <span className="hint">only new uploads</span>
            </label>
            <label
              className={`radio-row${grabMode === "last-n" ? " selected" : ""}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).tagName === "SELECT") return;
                setGrabMode("last-n");
              }}
            >
              <span className="radio" />
              <span>Last</span>
              <select
                className="select"
                style={{ margin: "0 4px" }}
                value={lastN}
                onChange={(e) => setLastN(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>videos and forward</span>
            </label>
            <label
              className={`radio-row${grabMode === "full" ? " selected" : ""}`}
              onClick={() => setGrabMode("full")}
            >
              <span className="radio" />
              <span>The full back catalog</span>
            </label>
          </div>

          <div className="field-label">Mode</div>
          <div className="inline-controls">
            <label className="checkbox" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="channel-mode"
                checked={mode === "video"}
                onChange={() => setMode("video")}
              />
              Video
            </label>
            <label className="checkbox" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="channel-mode"
                checked={mode === "audio"}
                onChange={() => setMode("audio")}
              />
              Audio (extract music)
            </label>
          </div>

          <div className="field-label">
            {mode === "audio" ? "Video quality (unused in audio mode)" : "Quality"}
          </div>
          <div className="inline-controls">
            <select
              className="select"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={mode === "audio"}
            >
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="Best">Best available</option>
            </select>
            <select
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={mode === "audio"}
            >
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
              <option value="mkv">MKV</option>
            </select>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={skipShorts}
                onChange={(e) => setSkipShorts(e.target.checked)}
              />
              <span className="box" />
              Skip Shorts
            </label>
          </div>
          {mode === "audio" ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--text-tertiary)",
              }}
            >
              Audio format and quality are configured in the Audio Settings sheet
              (♪ icon in the toolbar).
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                marginTop: 14,
                padding: "8px 10px",
                borderRadius: 6,
                background: "rgba(255,59,48,0.10)",
                color: "var(--danger)",
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
        <div className="sheet-actions">
          <button
            className="btn-secondary cancel"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn-primary confirm"
            onClick={handleSubmit}
            disabled={submitting || realUrlCount === 0}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </>
  );
}
