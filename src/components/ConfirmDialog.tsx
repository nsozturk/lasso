type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

/// Lightweight confirmation dialog. Used wherever a native `window.confirm`
/// would be blocked by Tauri's WebView runtime. Reuses the existing
/// `.sheet` styles for a consistent look.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  return (
    <>
      <div
        className="sheet-backdrop open"
        style={{ zIndex: 200 }}
        onClick={onCancel}
      />
      <div
        className="sheet open"
        style={{ zIndex: 201, maxWidth: 380 }}
      >
        <h2>{title}</h2>
        <div className="sheet-body" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {message}
        </div>
        <div className="sheet-actions">
          <button className="btn-secondary cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn-primary confirm${variant === "danger" ? " danger" : ""}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
