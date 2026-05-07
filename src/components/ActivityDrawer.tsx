import { CloseIcon, SyncIcon } from "../icons";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ActivityDrawer({ open, onClose }: Props) {
  return (
    <aside className={`drawer${open ? " open" : ""}`}>
      <div className="drawer-header">
        <h2>Activity</h2>
        <button className="btn-icon" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="drawer-body">
        <div
          style={{
            padding: "32px 12px",
            color: "var(--text-tertiary)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          No active downloads.
          <br />
          <span style={{ fontSize: 11 }}>Download queue lands in the next iteration.</span>
        </div>
      </div>
      <div className="drawer-footer">
        <SyncIcon width={13} height={13} />
        Auto-sync runs when you open Lasso.
      </div>
    </aside>
  );
}
