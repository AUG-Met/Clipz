import { useState, useEffect, useRef } from "react";
import { HistoryItem, Category } from "../types";
import { t } from "../i18n";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { extractLinks } from "../lib/links";

interface Props {
  item: HistoryItem | null;
  category: Category;
  quicklookEnabled: boolean;
  onHoverFile?: (path: string | null) => void;
  onTextEdit?: (text: string | null) => void;
  isFileFavorite?: (itemId: number, filePath: string) => boolean;
  onToggleFavorite?: (itemId: number, filePath?: string) => void;
  onCopySingleFile?: (filePath: string) => void;
}

export function PreviewPanel({ item, category, quicklookEnabled, onHoverFile, onTextEdit, isFileFavorite, onToggleFavorite, onCopySingleFile }: Props) {
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

  // Reset edited text when the selected item changes.
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

  const DOC_EXTS = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"];
  const MEDIA_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp3", ".wav", ".flac", ".aac", ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".webm", ".flv"];

  const extOf = (path: string): string => {
    const idx = path.lastIndexOf(".");
    return idx >= 0 ? path.slice(idx).toLowerCase() : "";
  };

  const fileCategory = (path: string): Category | null => {
    const ext = extOf(path);
    if (DOC_EXTS.includes(ext)) return "documents";
    if (MEDIA_EXTS.includes(ext)) return "media";
    return "other";
  };

  const isNamedCategory = (c: Category): boolean =>
    c === "documents" || c === "media" || c === "other";

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

  const handleFavoriteFile = () => {
    if (!contextMenu || !item) return;
    onToggleFavorite?.(item.id, contextMenu.filePath);
    setContextMenu(null);
  };

  const fileFav = contextMenu && item ? isFileFavorite?.(item.id, contextMenu.filePath) ?? false : false;

  const handleCopySingleFile = () => {
    if (!contextMenu) return;
    onCopySingleFile?.(contextMenu.filePath);
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
    // Links category: show all links at the top, then the original source.
    if (category === "links" && item.type === "text" && item.text_value) {
      const links = extractLinks(item.text_value);
      const trimmed = item.text_value.trim();
      return (
        <div className="preview-content">
          <div className="preview-link-list">
            {links.map((link, i) => (
              <div key={i} className="preview-link-item">
                🔗 <span style={{ userSelect: "text", wordBreak: "break-all" }}>{link}</span>
              </div>
            ))}
          </div>
          {(links.length > 1 || trimmed !== links[0]) && (
            <div className="preview-link-source" style={{ userSelect: "text" }}>
              {item.text_value}
            </div>
          )}
        </div>
      );
    }
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
      // Skip if the file doesn't match the current named category
      if (isNamedCategory(category) && category !== "all" && fileCategory(fullPath) !== category) {
        return null;
      }
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
      // Filter files by category when in a named category
      const showPaths = isNamedCategory(category) && category !== "all" && category !== "favorites"
        ? paths.filter((p) => fileCategory(p) === category)
        : paths;
      const countKey = category === "media" ? "preview_count_media"
        : category === "documents" ? "preview_count_documents"
        : category === "other" ? "preview_count_other"
        : "preview_count_file";
      if (showPaths.length === 0) return null;
      return (
        <div className="preview-content">
          <div style={{ fontSize: 15, fontWeight: "bold", marginBottom: 8, userSelect: "text" }}>
            <span style={{ userSelect: "none", pointerEvents: "none" }}>📂</span> {t(countKey, { n: showPaths.length })}
          </div>
          {showPaths.slice(0, 20).map((p, i) => (
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
          <button onClick={handleCopySingleFile}>
            📋 {t("context_copy_file")}
          </button>
          {onToggleFavorite && (
            <>
              <div className="separator" />
              <button onClick={handleFavoriteFile}>
                {fileFav ? "★" : "☆"} {fileFav ? t("context_unfavorite_file") : t("context_favorite_file")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}