import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, setLanguage, getLanguage, onLanguageChange } from "./i18n";
import { HistoryItem, AppSettings, ClickMode, Category, FavoriteEntry } from "./types";
import { HistoryList } from "./components/HistoryList";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { BottomBar } from "./components/BottomBar";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { extractLinks } from "./lib/links";

const CATEGORIES: Category[] = ["all", "favorites", "text", "links", "documents", "media", "other"];

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    language: "zh",
    theme: "system",
    hotkey_modifier: "ctrl",
    hotkey_key: "F1",
    click_mode: 1,
    autostart: false,
    quicklook: false,
    quicklook_path: null,
    auto_collapse: true,
  });
  const [clickMode, setClickMode] = useState<ClickMode>(1);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const systemDarkRef = useRef<MediaQueryList | null>(null);
  const hoveredFileRef = useRef<string | null>(null);
  const editedTextRef = useRef<string | null>(null);
  const themeSettingRef = useRef<string>("light");

  // Resolve the effective theme: if "system", detect from OS; otherwise use the setting.
  const resolveTheme = useCallback((setting: string): "light" | "dark" => {
    if (setting === "system") {
      if (systemDarkRef.current) {
        return systemDarkRef.current.matches ? "dark" : "light";
      }
      // Fallback: create the query
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return setting as "light" | "dark";
  }, []);

  // Apply the resolved theme to the Windows title bar.
  const applyTitleBarTheme = useCallback((resolvedTheme: string) => {
    invoke("set_theme", { theme: resolvedTheme }).catch(() => {});
  }, []);

  // Apply theme (both CSS vars and Windows title bar)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    applyTitleBarTheme(theme);
  }, [theme, applyTitleBarTheme]);

  // Keep a ref of the raw theme setting so the system-theme-change handler
  // (registered once) can re-apply a forced theme without stale closures.
  useEffect(() => {
    themeSettingRef.current = settings.theme;
  }, [settings.theme]);

  // i18n
  useEffect(() => {
    setLanguage(getLanguage());
    return onLanguageChange((l) => setLang(l));
  }, []);

  // Load history + settings from backend on mount
  useEffect(() => {
    loadHistory();
    loadSettings();
    loadFavorites();

    let unlistenFn: (() => void) | null = null;

    listen<HistoryItem>("clipboard-changed", (event) => {
      setItems((prev) => {
        const next = [event.payload, ...prev.filter((i) => i.id !== event.payload.id)];
        return next.slice(0, 200);
      });
    }).then((fn) => {
      unlistenFn = fn;
    });

    // Fallback: refresh every 1 second in case the event is missed
    const interval = setInterval(() => {
      loadHistory();
    }, 1000);

    // Listen for OS theme changes so "system" theme stays in sync.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    systemDarkRef.current = media;
    const onSystemThemeChange = () => {
      if (themeSettingRef.current === "system") {
        setTheme(media.matches ? "dark" : "light");
      } else {
        // Forced theme: re-apply it so an OS theme change cannot override
        // the title bar.
        applyTitleBarTheme(themeSettingRef.current);
      }
    };
    media.addEventListener("change", onSystemThemeChange);

    return () => {
      if (unlistenFn) unlistenFn();
      clearInterval(interval);
      media.removeEventListener("change", onSystemThemeChange);
    };
  }, []);

  // Show toast
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  // Trigger QuickLook preview for a file path
  const quickLookPath = useCallback(async (filePath: string) => {
    try {
      const status = await invoke<string>("quicklook_preview", { path: filePath });
      if (status === "not_found") {
        showToast(t("ql_not_found"));
      } else if (status === "preview_error") {
        showToast(t("ql_preview_error"));
      }
    } catch (e) {
      showToast(t("ql_preview_error"));
    }
  }, [showToast]);

  // QuickLook: space key previews the hovered file only
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!settings.quicklook) return;

      // Ignore if focus is in an input/textarea (e.g. search box)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      e.preventDefault();
      const hovered = hoveredFileRef.current;
      if (hovered) {
        quickLookPath(hovered);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settings.quicklook, quickLookPath]);

  const loadHistory = useCallback(async (query?: string) => {
    try {
      const history = await invoke<HistoryItem[]>("get_history", {
        search_query: query ?? null,
      });
      setItems(history);
    } catch (e) {
      console.error("load history failed", e);
      showToast("加载历史记录失败");
    }
  }, [showToast]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await invoke<AppSettings>("get_settings");
      setSettings(s);
      setTheme(resolveTheme(s.theme));
      setClickMode(s.click_mode as ClickMode);
      setLanguage(s.language as "zh" | "en");
    } catch (e) {
      console.error("load settings failed", e);
    }
  }, [resolveTheme]);

  const loadFavorites = useCallback(async () => {
    try {
      const favs = await invoke<FavoriteEntry[]>("get_favorites");
      setFavorites(favs);
    } catch (e) {
      console.error("load favorites failed", e);
    }
  }, []);

  // Toggle favorite status for an item, or a specific file within an item.
  const toggleFavorite = useCallback(async (itemId: number, filePath?: string) => {
    const keyPath = filePath ?? null;
    try {
      const nowFav = await invoke<boolean>("toggle_favorite", {
        itemId,
        filePath: keyPath,
      });
      setFavorites((prev) => {
        // Remove any existing entry for this (item, file) key.
        const rest = prev.filter(
          (f) => !(f.item_id === itemId && f.file_path === keyPath)
        );
        if (nowFav) {
          return [...rest, { item_id: itemId, file_path: keyPath }];
        }
        return rest;
      });
    } catch (e) {
      console.error("toggle favorite failed", e);
    }
  }, []);

  // True if the whole item is a favorite (favorited with no specific file).
  const isItemFavorite = useCallback((itemId: number): boolean => {
    return favorites.some((f) => f.item_id === itemId && f.file_path === null);
  }, [favorites]);

  // True if a specific file path within an item is favorited.
  const isFileFavorite = useCallback((itemId: number, filePath: string): boolean => {
    return favorites.some((f) => f.item_id === itemId && f.file_path === filePath);
  }, [favorites]);

  // Copy item back to the system clipboard
  const parsePaths = (json: string | null): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed.map(String);
      return [String(parsed)];
    } catch {
      return json.split("\n").filter(Boolean);
    }
  };

  const copyItem = useCallback(async (item: HistoryItem) => {
    try {
      if (item.type === "text") {
        // Copy the edited text if the user modified it in the preview.
        const text = editedTextRef.current ?? item.text_value ?? "";
        // Use the backend command so the clipboard monitor suppresses this
        // change and does not create a duplicate history entry.
        await invoke("copy_text", { text });
      } else if (item.type === "file" || item.type === "files") {
        let paths = parsePaths(item.text_value);
        // In a named category, only copy the files that match that category
        // (mirrors the "包含即归入" preview filtering).
        if (
          (category === "documents" || category === "media" || category === "other") &&
          paths.length > 1
        ) {
          paths = paths.filter((p) => fileCategory(p) === category);
        }
        if (paths.length > 0) {
          await invoke("copy_files", { paths });
        } else {
          return;
        }
      } else if (item.type === "image" && item.image_path) {
        await invoke("copy_image", { path: item.image_path });
      } else {
        // Unsupported type — nothing to copy.
        return;
      }
      showToast(t("copied"));
    } catch (e) {
      console.error("copy failed", e);
    }
    if (clickMode === 2 || clickMode === 4) {
      // Copy & close
      try {
        await invoke("hide_window");
      } catch (e) {
        console.error("hide failed", e);
      }
    }
  }, [clickMode, showToast, category]);

  // Copy a single file from a multi-file item as a NEW history entry.
  const copySingleFile = useCallback(async (filePath: string) => {
    try {
      await invoke("copy_file_as_new", { paths: [filePath] });
      showToast(t("copied"));
    } catch (e) {
      console.error("copy file as new failed", e);
    }
  }, [showToast]);

  // Delete item
  const deleteItem = useCallback(async (id: number) => {
    try {
      await invoke("delete_item", { id });
      setItems((prev) => prev.filter((i) => i.id !== id));
      setSelectedItem((prev) => (prev?.id === id ? null : prev));
    } catch (e) {
      console.error("delete failed", e);
    }
  }, []);

  // Open file(s) with the default application
  const openItem = useCallback(async (item: HistoryItem) => {
    const paths = parsePaths(item.text_value);
    if (paths.length > 0) {
      try {
        await invoke("open_paths", { paths });
      } catch (e) {
        console.error("open failed", e);
      }
    }
  }, []);

  // Open the containing folder of the first file
  const openFolder = useCallback(async (item: HistoryItem) => {
    const paths = parsePaths(item.text_value);
    const first = paths[0] || item.image_path;
    if (first) {
      try {
        await invoke("open_folder", { path: first });
      } catch (e) {
        console.error("open folder failed", e);
      }
    }
  }, []);

  // Clear history (keeps favorited items). Uses a custom confirm dialog
  // (native window.confirm is unreliable in the Tauri WebView).
  const clearHistory = useCallback(() => {
    setConfirmDialog({
      message: t("clear_confirm_msg2"),
      onConfirm: () => {
        setConfirmDialog(null);
        doClear();
      },
    });
  }, [showToast]);

  const doClear = useCallback(async () => {
    try {
      await invoke("clear_history");
      await loadHistory(); // reload — favorited items remain in history
      setSelectedItem(null);
      showToast(t("cleared"));
    } catch (e) {
      console.error("clear failed", e);
    }
  }, [loadHistory, showToast]);

  // Handle settings save
  const handleSettingsSave = useCallback(async (newSettings: AppSettings) => {
    try {
      await invoke("save_settings", { settings: newSettings });
    } catch (e) {
      console.error("save settings failed", e);
    }
    // Apply autostart toggle
    try {
      await invoke("set_autostart", { enabled: newSettings.autostart });
    } catch (e) {
      console.error("set autostart failed", e);
    }
    setSettings(newSettings);
    setTheme(resolveTheme(newSettings.theme));
    setLanguage(newSettings.language);
    setClickMode(newSettings.click_mode as ClickMode);
    showToast(t("toast_settings_saved"));
    setShowSettings(false);
  }, [showToast, resolveTheme]);

  // Filter items by search
  const searchFiltered = searchQuery
    ? items.filter((item) =>
        item.text_value?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  // --- Category classification ---
  const DOC_EXTS = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"];
  const MEDIA_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp3", ".wav", ".flac", ".aac", ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".webm", ".flv"];

  const extOf = (path: string): string => {
    const idx = path.lastIndexOf(".");
    return idx >= 0 ? path.slice(idx).toLowerCase() : "";
  };

  /** Return all categories a file belongs to (by extension). */
  const fileCategory = (path: string): Category | null => {
    const ext = extOf(path);
    if (DOC_EXTS.includes(ext)) return "documents";
    if (MEDIA_EXTS.includes(ext)) return "media";
    return "other";
  };

  /** Return all categories a history item belongs to (multi-file items can
   *  match several categories via "包含即归入"). */
  const itemCategories = (item: HistoryItem): Category[] => {
    if (item.type === "text") return ["text"];
    if (item.type === "image") return ["media"];
    if (item.type === "file" || item.type === "files") {
      const paths = parsePaths(item.text_value);
      const cats = new Set<Category>();
      for (const p of paths) {
        const c = fileCategory(p);
        if (c) cats.add(c);
      }
      return Array.from(cats);
    }
    return ["other"];
  };

  // Build the display list for the active category.
  const displayItems: HistoryItem[] = (() => {
    if (category === "favorites") {
      const out: HistoryItem[] = [];
      for (const fav of favorites) {
        const item = items.find((i) => i.id === fav.item_id);
        if (!item) continue;
        if (fav.file_path === null) {
          out.push(item);
        } else {
          out.push({
            ...item,
            type: "file",
            text_value: JSON.stringify([fav.file_path]),
          });
        }
      }
      return out;
    }
    const base = searchFiltered;
    if (category === "links") {
      // One item per origin text; show link count in the list, all links in
      // the preview.
      return base.filter(
        (item) => item.type === "text" && item.text_value && extractLinks(item.text_value).length > 0
      );
    }
    // "all" or named categories
    return base.filter((item) => {
      if (category === "all") return true;
      const cats = itemCategories(item);
      return cats.includes(category);
    });
  })();

  // Unique react key for each display item (handles virtual single-file
  // favorites sharing the same underlying item id).
  const displayKey = (item: HistoryItem): string => {
    if (category === "favorites" && item.type === "file") {
      const paths = parsePaths(item.text_value);
      return `${item.id}:file:${paths[0] ?? ""}`;
    }
    return `${item.id}`;
  };

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      {/* Top Bar — hidden in settings view */}
      {!showSettings && (
        <div className="top-bar">
          <h1>{t("app_title")}</h1>
          <button className="topbar-settings-btn" onClick={() => setShowSettings(true)}>
            ⚙️ {t("btn_settings")}
          </button>

          <div className="search-box">
            <span>🔍</span>
            <input
              type="text"
              placeholder={t("search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Category bar — hidden in settings view */}
      {!showSettings && (
        <div className="category-bar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`category-tab ${category === cat ? "active" : ""}`}
              onClick={() => setCategory(cat)}
            >
              {t(`category_${cat}`)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onSave={handleSettingsSave}
          onBack={() => setShowSettings(false)}
        />
      ) : (
        <div className="content">
          <div className="left-panel">
            <h2>{t("history_title")}</h2>
            <HistoryList
              items={displayItems}
              itemKey={displayKey}
              selectedId={selectedItem?.id ?? null}
              clickMode={clickMode}
              autoCollapse={settings.auto_collapse}
              category={category}
              isFavorite={isItemFavorite}
              onToggleFavorite={toggleFavorite}
              onSelect={setSelectedItem}
              onCopy={copyItem}
              onDelete={deleteItem}
              onOpen={openItem}
              onOpenFolder={openFolder}
            />
          </div>

          <PreviewPanel
            item={selectedItem}
            category={category}
            quicklookEnabled={settings.quicklook}
            onHoverFile={(p) => { hoveredFileRef.current = p; }}
            onTextEdit={(t) => { editedTextRef.current = t; }}
            isFileFavorite={isFileFavorite}
            onToggleFavorite={toggleFavorite}
            onCopySingleFile={copySingleFile}
          />
        </div>
      )}

      {/* Bottom Bar — hidden in settings view */}
      {!showSettings && (
        <BottomBar
          count={items.length}
          onClear={clearHistory}
        />
      )}

      {/* Toast */}
      <Toast message={toast} />

      {/* Confirm dialog (replaces unreliable native window.confirm) */}
      {confirmDialog && (
        <ConfirmDialog
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

export default App;