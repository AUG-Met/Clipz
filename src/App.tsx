import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { t, setLanguage, getLanguage, onLanguageChange } from "./i18n";
import { HistoryItem, AppSettings, ClickMode } from "./types";
import { HistoryList } from "./components/HistoryList";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { BottomBar } from "./components/BottomBar";
import { Toast } from "./components/Toast";

function App() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<AppSettings>({
    language: "zh",
    theme: "light",
    hotkey_modifier: "ctrl",
    hotkey_key: "F1",
    click_mode: 1,
    autostart: false,
    quicklook: false,
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

    let unlistenFn: (() => void) | null = null;

    listen<HistoryItem>("clipboard-changed", (event) => {
      setItems((prev) => {
        const next = [event.payload, ...prev.filter((i) => i.id !== event.payload.id)];
        return next.slice(0, 200);
      });
    }).then((fn) => {
      unlistenFn = fn;
    });

    // Fallback: refresh every 2 seconds in case the event is missed
    const interval = setInterval(() => {
      loadHistory();
    }, 2000);

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
        const paths = parsePaths(item.text_value);
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
  }, [clickMode, showToast]);

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

  // Clear history
  const clearHistory = useCallback(async () => {
    if (confirm(t("clear_confirm_msg"))) {
      try {
        await invoke("clear_history");
        setItems([]);
        setSelectedItem(null);
        showToast(t("cleared"));
      } catch (e) {
        console.error("clear failed", e);
      }
    }
  }, [showToast]);

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
  const filteredItems = searchQuery
    ? items.filter((item) =>
        item.text_value?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  return (
    <div className="app" onContextMenu={(e) => e.preventDefault()}>
      {/* Top Bar — hidden in settings view */}
      {!showSettings && (
        <div className="top-bar">
          <h1>{t("app_title")}</h1>

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
              items={filteredItems}
              selectedId={selectedItem?.id ?? null}
              clickMode={clickMode}
              onSelect={setSelectedItem}
              onCopy={copyItem}
              onDelete={deleteItem}
              onOpen={openItem}
              onOpenFolder={openFolder}
            />
          </div>

          <PreviewPanel
            item={selectedItem}
            quicklookEnabled={settings.quicklook}
            onHoverFile={(p) => { hoveredFileRef.current = p; }}
            onTextEdit={(t) => { editedTextRef.current = t; }}
          />
        </div>
      )}

      {/* Bottom Bar — hidden in settings view */}
      {!showSettings && (
        <BottomBar
          count={items.length}
          onSettings={() => setShowSettings(true)}
          onClear={clearHistory}
        />
      )}

      {/* Toast */}
      <Toast message={toast} />
    </div>
  );
}

export default App;