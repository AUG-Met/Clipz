import { useState, useRef, useEffect } from "react";
import { HistoryItem, ClickMode } from "../types";
import { t } from "../i18n";

interface Props {
  items: HistoryItem[];
  selectedId: number | null;
  clickMode: ClickMode;
  onSelect: (item: HistoryItem) => void;
  onCopy: (item: HistoryItem) => void;
  onDelete: (id: number) => void;
  onOpen: (item: HistoryItem) => void;
  onOpenFolder: (item: HistoryItem) => void;
}

export function HistoryList({ items, selectedId, clickMode, onSelect, onCopy, onDelete, onOpen, onOpenFolder }: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: HistoryItem;
  } | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside, window blur, or when another menu opens
  useEffect(() => {
    const onClick = () => setContextMenu(null);
    const onBlur = () => setContextMenu(null);
    const onCloseMenus = () => setContextMenu(null);
    window.addEventListener("click", onClick);
    window.addEventListener("blur", onBlur);
    window.addEventListener("close-context-menus", onCloseMenus);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("close-context-menus", onCloseMenus);
    };
  }, []);

  // Clamp menu position to stay within the viewport
  useEffect(() => {
    if (contextMenu && menuRef.current) {
      const r = menuRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = contextMenu.x;
      let y = contextMenu.y;
      if (x + r.width > vw - 8) x = vw - r.width - 8;
      if (y + r.height > vh - 8) y = vh - r.height - 8;
      setMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    } else {
      setMenuPos(null);
    }
  }, [contextMenu]);

  const handleClick = (item: HistoryItem) => {
    onSelect(item);
    if (clickMode === 1 || clickMode === 2) {
      onCopy(item);
    }
  };

  const handleDoubleClick = (item: HistoryItem) => {
    if (clickMode === 3 || clickMode === 4) {
      onCopy(item);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, item: HistoryItem) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("close-context-menus"));
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // Parse the JSON-array file paths stored in text_value into a list of paths.
  const parseFilePaths = (json: string | null): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [String(parsed)];
    } catch {
      return json.split("\n").filter(Boolean);
    }
  };

  const fileName = (path: string): string =>
    path.split("\\").pop() || path.split("/").pop() || path;

  const formatPreview = (item: HistoryItem): string => {
    if (item.type === "text") {
      const text = item.text_value ?? "";
      const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
      return "📝 " + preview;
    }
    if (item.type === "files") {
      const paths = parseFilePaths(item.text_value);
      const first = paths[0] || "";
      const extra = paths.length > 1 ? ` (+${paths.length - 1})` : "";
      return "📂 " + fileName(first) + extra;
    }
    if (item.type === "file") {
      const paths = parseFilePaths(item.text_value);
      const first = paths[0] || "";
      return "📄 " + fileName(first);
    }
    if (item.type === "image") {
      return "📄 " + fileName(item.image_path || "image");
    }
    return "";
  };

  const formatTime = (createdAt: string): string => {
    return createdAt.length >= 16 ? createdAt.slice(0, 16) : createdAt;
  };

  return (
    <div className="history-list" ref={listRef}>
      {items.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "var(--secondary-text)",
            fontSize: "14px",
          }}
        >
          {t("no_records")}
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={`history-item ${item.id === selectedId ? "selected" : ""}`}
            onClick={() => handleClick(item)}
            onDoubleClick={() => handleDoubleClick(item)}
            onContextMenu={(e) => handleContextMenu(e, item)}
          >
            {formatPreview(item)}
            <div className="time">{formatTime(item.created_at)}</div>
          </div>
        ))
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menuPos?.x ?? contextMenu.x, top: menuPos?.y ?? contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          {contextMenu.item.type === "file" && (
            <>
              <button onClick={() => { onOpen(contextMenu.item); setContextMenu(null); }}>
                📄 {t("context_open")}
              </button>
              <button onClick={() => { onOpenFolder(contextMenu.item); setContextMenu(null); }}>
                📂 {t("context_browse")}
              </button>
              <div className="separator" />
            </>
          )}
          <button onClick={() => { onDelete(contextMenu.item.id); setContextMenu(null); }}>
            🗑 {t("context_delete")}
          </button>
        </div>
      )}
    </div>
  );
}