import { useEffect, useRef } from "react";

export type ContextMenuItem = {
  label: string;
  onClick: () => void;
  /// Renders the item with danger styling (red on hover).
  danger?: boolean;
  disabled?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

/// Floating right-click menu. Renders at fixed page coordinates and closes on
/// outside click or Escape.
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: y, left: x }}
      role="menu"
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
