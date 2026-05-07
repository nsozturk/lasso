import { useEffect, useState } from "react";
import { api } from "../api";

type Mode = "video" | "audio";

type Props = {
  open: boolean;
  channelName: string;
  pendingCount: number;
  onClose: () => void;
  onConfirm: (opts: {
    audioFormat?: string;
    quality?: string;
    format?: string;
  }) => void;
};

const VIDEO_QUALITIES = [
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "Best", label: "Best available" },
];
const VIDEO_FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "mkv", label: "MKV" },
];
const AUDIO_FORMATS = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "flac", label: "FLAC (lossless)" },
  { value: "opus", label: "OPUS" },
  { value: "wav", label: "WAV (lossless)" },
  { value: "ogg", label: "OGG (Vorbis)" },
  { value: "aac", label: "AAC" },
  { value: "alac", label: "ALAC (lossless)" },
];

export function DownloadAllSheet({
  open,
  channelName,
  pendingCount,
  onClose,
  onConfirm,
}: Props) {
  const [mode, setMode] = useState<Mode>("video");
  const [quality, setQuality] = useState("1080p");
  const [format, setFormat] = useState("mp4");
  const [audioFormat, setAudioFormat] = useState("mp3");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getSettings();
        if (cancelled) return;
        if (s.default_quality) setQuality(s.default_quality);
        if (s.default_format) setFormat(s.default_format);
        if (s.default_audio_format) setAudioFormat(s.default_audio_format);
      } catch (e) {
        console.error("getSettings failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleSubmit() {
    if (mode === "audio") {
      onConfirm({ audioFormat });
    } else {
      onConfirm({ quality, format });
    }
    onClose();
  }

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " open" : ""}`}
        onClick={onClose}
      />
      <div className={`sheet${open ? " open" : ""}`}>
        <h2>Download all from {channelName}</h2>
        <div className="sheet-body">
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              margin: "0 0 16px",
              lineHeight: 1.5,
            }}
          >
            {pendingCount} pending or failed video{pendingCount === 1 ? "" : "s"} will be queued.
            Pick how you want them.
          </p>

          <div className="field-label">Save as</div>
          <div className="inline-controls">
            <label className="checkbox" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="bulk-mode"
                checked={mode === "video"}
                onChange={() => setMode("video")}
              />
              Video
            </label>
            <label className="checkbox" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="bulk-mode"
                checked={mode === "audio"}
                onChange={() => setMode("audio")}
              />
              Audio (extract music)
            </label>
          </div>

          {mode === "video" ? (
            <>
              <div className="field-label">Quality</div>
              <div className="inline-controls">
                <select
                  className="select"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {VIDEO_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="field-label">Audio format</div>
              <select
                className="select"
                value={audioFormat}
                onChange={(e) => setAudioFormat(e.target.value)}
              >
                {AUDIO_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  lineHeight: 1.4,
                }}
              >
                Bitrate / quality is taken from Audio Settings (♪ icon).
              </p>
            </>
          )}
        </div>
        <div className="sheet-actions">
          <button className="btn-secondary cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary confirm" onClick={handleSubmit}>
            {mode === "audio"
              ? `Queue ${pendingCount} as ${audioFormat.toUpperCase()}`
              : `Queue ${pendingCount} (${quality} ${format.toUpperCase()})`}
          </button>
        </div>
      </div>
    </>
  );
}
