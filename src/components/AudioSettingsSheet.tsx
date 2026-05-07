import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "./Toast";
import type { Settings } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
};

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

// yt-dlp `--audio-quality` accepts 0..10 (0 = best) for lossy codecs, or a specific
// bitrate like `192K`. Lossless formats (FLAC / WAV / ALAC) ignore this value.
const AUDIO_QUALITIES = [
  { value: "0", label: "Best (yt-dlp default)" },
  { value: "320K", label: "320 kbps (high)" },
  { value: "256K", label: "256 kbps" },
  { value: "192K", label: "192 kbps (standard)" },
  { value: "128K", label: "128 kbps (light)" },
  { value: "96K", label: "96 kbps (small)" },
];

export function AudioSettingsSheet({ open, onClose }: Props) {
  const { toast } = useToast();
  const [format, setFormat] = useState("mp3");
  const [quality, setQuality] = useState("0");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await api.getSettings();
        if (cancelled) return;
        if (s.default_audio_format) setFormat(s.default_audio_format);
        if (s.default_audio_quality) setQuality(s.default_audio_quality);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Settings = {
        default_audio_format: format,
        default_audio_quality: quality,
      };
      await api.updateSettings(patch);
      toast("Audio settings saved", "success");
      onClose();
    } catch (e) {
      setError(String(e));
      toast("Couldn't save audio settings", "error");
    } finally {
      setSaving(false);
    }
  }

  const isLossless = format === "flac" || format === "wav" || format === "alac";

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " open" : ""}`}
        onClick={() => !saving && onClose()}
      />
      <div className={`sheet${open ? " open" : ""}`}>
        <h2>Audio extraction</h2>
        <div className="sheet-body">
          {loading ? (
            <div style={{ padding: 12, color: "var(--text-secondary)" }}>
              Loading…
            </div>
          ) : (
            <>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  margin: "0 0 14px",
                  lineHeight: 1.5,
                }}
              >
                These defaults are applied when a channel is in audio mode, and to
                per-video "Download as …" actions from the kebab menu.
              </p>

              <div className="field-label">Default audio format</div>
              <select
                className="select"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {AUDIO_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>

              <div className="field-label">
                Default audio quality
                {isLossless ? " (ignored for lossless)" : ""}
              </div>
              <select
                className="select"
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={isLossless}
              >
                {AUDIO_QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>

              <div className="settings-info">
                <div>
                  <span className="info-label">Backend</span>
                  <span className="info-value">yt-dlp -x via ffmpeg</span>
                </div>
                <div>
                  <span className="info-label">Required</span>
                  <span className="info-value">ffmpeg on PATH</span>
                </div>
              </div>

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
            </>
          )}
        </div>
        <div className="sheet-actions">
          <button
            className="btn-secondary cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn-primary confirm"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
