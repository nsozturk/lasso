import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: (channelId: string) => void;
};

type GrabMode = "now-on" | "last-n" | "full";
type ChannelMode = "video" | "audio";

export function AddChannelSheet({ open, onClose, onAdded }: Props) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [grabMode, setGrabMode] = useState<GrabMode>("now-on");
  const [lastN, setLastN] = useState<number>(25);
  const [quality, setQuality] = useState<string>("1080p");
  const [format, setFormat] = useState<string>("mp4");
  const [mode, setMode] = useState<ChannelMode>("video");
  const [skipShorts, setSkipShorts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate from settings whenever sheet opens.
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
    setUrl("");
    setGrabMode("now-on");
    setMode("video");
    setError(null);
  }

  async function handleSubmit() {
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const initial =
        grabMode === "now-on" ? 0 : grabMode === "last-n" ? lastN : 1000;
      const channel = await api.addChannel(
        url.trim(),
        initial,
        quality,
        format,
        skipShorts,
        mode,
      );
      onAdded(channel.id);
      toast(`Added “${channel.name}”`, "success");
      reset();
      onClose();
    } catch (e) {
      setError(String(e));
      toast("Couldn't add channel", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " open" : ""}`}
        onClick={() => !submitting && onClose()}
      />
      <div className={`sheet${open ? " open" : ""}`}>
        <h2>Add a channel to your library</h2>
        <div className="sheet-body">
          <input
            className="sheet-input"
            type="text"
            placeholder="https://youtube.com/@channelname"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus={open}
            disabled={submitting}
          />

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
            disabled={submitting || !url.trim()}
          >
            {submitting ? "Fetching…" : "Add channel"}
          </button>
        </div>
      </div>
    </>
  );
}
