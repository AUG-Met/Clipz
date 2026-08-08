import { useState, useEffect, useRef } from "react";
import { HistoryItem } from "../types";
import { t } from "../i18n";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

interface Props {
  item: HistoryItem | null;
  quicklookEnabled: boolean;
  onHoverFile?: (path: string | null) => void;
  onTextEdit?: (text: string | null) => void;
}

export function PreviewPanel({ item, quicklookEnabled, onHoverFile, onTextEdit }: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
  } | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside, blur, or other menu opening
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

  // Reset edited text when the selected item changes
  useEffect(() => {
    if (item?.type === "text") {
      onTextEdit?.(item.text_value ?? "");
    } else {
      onTextEdit?.(null);
    }
  }, [item?.id, item?.type]);

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

  const parentDir = (path: string): string => {
    const idx = path.lastIndexOf("\\");
    if (idx > 0) return path.slice(0, idx);
    const idx2 = path.lastIndexOf("/");
    if (idx2 > 0) return path.slice(0, idx2);
    return path;
  };

  const handleContext = (e: React.MouseEvent, filePath: string) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("close-context-menus"));
    setContextMenu({ x: e.clientX, y: e.clientY, filePath });
  };

  const openFile = async (filePath: string) => {
    try {
      await invoke("open_paths", { paths: [filePath] });
    } catch (e) {
      console.error("open failed", e);
    }
  };

  const handleOpen = async () => {
    if (!contextMenu) return;
    await openFile(contextMenu.filePath);
    setContextMenu(null);
  };

  const handleOpenFolder = async () => {
    if (!contextMenu) return;
    try {
      await invoke("open_folder", { path: contextMenu.filePath });
    } catch (e) {
      console.error("open folder failed", e);
    }
    setContextMenu(null);
  };

  if (!item) {
    return (
      <div className="right-panel">
        <div className="preview-title">{t("preview_title")}</div>
        <div className="preview-hint">{t("preview_hint")}</div>
      </div>
    );
  }

  const formatTime = (createdAt: string): string => {
    return createdAt.length >= 19 ? createdAt.slice(0, 19) : createdAt;
  };

  const renderContent = () => {
    if (item.type === "text") {
      return (
        <div
          key={item.id}
          className="preview-content preview-editable"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={(e) => onTextEdit?.(e.currentTarget.textContent ?? "")}
        >
          {item.text_value || ""}
        </div>
      );
    }
    if (item.type === "file") {
      const paths = parseFilePaths(item.text_value);
      const fullPath = paths[0] || "";
      return (
        <div className="preview-content">
          <div
            className="preview-file-item"
            onMouseEnter={() => onHoverFile?.(fullPath)}
            onMouseLeave={() => onHoverFile?.(null)}
            onContextMenu={(e) => handleContext(e, fullPath)}
          >
            <div style={{ userSelect: "text" }}>
              <span style={{ userSelect: "none", pointerEvents: "none" }}>📄</span> {fileName(fullPath)}
            </div>
            <div style={{ fontSize: 12, color: "var(--secondary-text)", marginTop: 8, wordBreak: "break-all", userSelect: "text" }}>
              {fullPath}
            </div>
          </div>
        </div>
      );
    }
    if (item.type === "files") {
      const paths = parseFilePaths(item.text_value);
      return (
        <div className="preview-content">
          <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8, userSelect: "text" }}>
            <span style={{ userSelect: "none", pointerEvents: "none" }}>📂</span> 共 {paths.length} 个文件
          </div>
          {paths.slice(0, 20).map((p, i) => (
            <div
              key={i}
              className="preview-file-item"
              onMouseEnter={() => onHoverFile?.(p)}
              onMouseLeave={() => onHoverFile?.(null)}
              onContextMenu={(e) => handleContext(e, p)}
            >
              <div style={{ userSelect: "text" }}>
                <span style={{ userSelect: "none", pointerEvents: "none" }}>📃</span> {fileName(p)}
              </div>
              <div style={{ fontSize: 12, color: "var(--secondary-text)", paddingLeft: 22, userSelect: "text" }}>
                {parentDir(p)}
              </div>
            </div>
          ))}
          {paths.length > 20 && <div style={{ fontSize: 12, color: "var(--secondary-text)", marginTop: 4 }}>…还有 {paths.length - 20} 个</div>}
        </div>
      );
    }
    if (item.type === "image") {
      return (
        <div className="preview-content" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {item.thumbnail_path ? (
            <img
              src={convertFileSrc(item.thumbnail_path)}
              alt="thumbnail"
              style={{ maxWidth: "100%", maxHeight: "300px", objectFit: "contain", borderRadius: 4 }}
            />
          ) : (
            <div style={{ color: "var(--secondary-text)" }}>
              🖼 {item.image_path?.split("\\").pop() || item.image_path?.split("/").pop() || "image"}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="right-panel">
      <div className="preview-title">
        {t("preview_title")} · {formatTime(item.created_at)}
      </div>
      {renderContent()}

      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menuPos?.x ?? contextMenu.x, top: menuPos?.y ?? contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <button onClick={handleOpen}>
            📄 {t("context_open")}
          </button>
          <button onClick={handleOpenFolder}>
            📂 {t("context_browse")}
          </button>
        </div>
      )}
    </div>
  );
}