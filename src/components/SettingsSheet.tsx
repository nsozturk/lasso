import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
};

const APP_VERSION = "0.0.1";

const DEFAULTS: Settings = {
  default_save_dir: "",
  default_quality: "1080p",
  default_format: "mp4",
  default_backlog: "25",
  skip_shorts_default: "1",
  concurrent_downloads: "1",
};

export function SettingsSheet({ open, onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
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
        if (!cancelled) setSettings({ ...DEFAULTS, ...s });
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

  function patch(key: string, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateSettings(settings);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " open" : ""}`}
        onClick={() => !saving && onClose()}
      />
      <div className={`sheet${open ? " open" : ""}`}>
        <h2>Settings</h2>
        <div className="sheet-body">
          {loading ? (
            <div style={{ padding: 12, color: "var(--text-secondary)" }}>
              Loading…
            </div>
          ) : (
            <>
              <div className="field-label">Default save folder</div>
              <input
                className="sheet-input"
                type="text"
                value={settings.default_save_dir ?? ""}
                onChange={(e) => patch("default_save_dir", e.target.value)}
                placeholder="/Users/you/Movies/Lasso"
                disabled={saving}
              />

              <div className="field-label">Default quality</div>
              <div className="inline-controls">
                <select
                  className="select"
                  value={settings.default_quality}
                  onChange={(e) => patch("default_quality", e.target.value)}
                >
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="Best">Best available</option>
                </select>
                <select
                  className="select"
                  value={settings.default_format}
                  onChange={(e) => patch("default_format", e.target.value)}
                >
                  <option value="mp4">MP4</option>
                  <option value="webm">WebM</option>
                  <option value="mkv">MKV</option>
                </select>
              </div>

              <div className="field-label">Default backlog for new channels</div>
              <select
                className="select"
                value={settings.default_backlog}
                onChange={(e) => patch("default_backlog", e.target.value)}
              >
                <option value="0">Only new uploads (0)</option>
                <option value="25">Last 25</option>
                <option value="50">Last 50</option>
                <option value="100">Last 100</option>
                <option value="1000">Full back catalog</option>
              </select>

              <div className="field-label">Concurrent downloads</div>
              <select
                className="select"
                value={settings.concurrent_downloads}
                onChange={(e) => patch("concurrent_downloads", e.target.value)}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>

              <div className="inline-controls" style={{ marginTop: 14 }}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.skip_shorts_default === "1"}
                    onChange={(e) =>
                      patch("skip_shorts_default", e.target.checked ? "1" : "0")
                    }
                  />
                  <span className="box" />
                  Skip Shorts by default
                </label>
              </div>

              <div className="settings-info">
                <div>
                  <span className="info-label">App version</span>
                  <span className="info-value">{APP_VERSION}</span>
                </div>
                <div>
                  <span className="info-label">Database</span>
                  <span className="info-value">
                    ~/Library/Application Support/dev.youlasso.app/lasso.db
                  </span>
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
