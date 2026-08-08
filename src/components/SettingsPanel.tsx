import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { AppSettings } from "../types";
import { t } from "../i18n";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onBack: () => void;
}

type Tab = "appearance" | "actions" | "other" | "about";

const MODIFIERS: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  ctrl_shift: "Ctrl+Shift",
  win: "Win",
  ctrl_win: "Ctrl+Win",
  alt_win: "Alt+Win",
  shift_win: "Shift+Win",
};

const KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

export function SettingsPanel({ settings: initial, onSave, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("appearance");
  const [settings, setSettings] = useState<AppSettings>(initial);
  const [capturingKey, setCapturingKey] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [qlNotFound, setQlNotFound] = useState(false);

  // Auto-detect QuickLook path when the toggle is turned on and no path is set.
  useEffect(() => {
    if (settings.quicklook && !settings.quicklook_path) {
      detectQuickLook();
    }
  }, [settings.quicklook]);

  const detectQuickLook = () => {
    setDetecting(true);
    setQlNotFound(false);
    invoke<string>("find_quicklook_path").then((path) => {
      setDetecting(false);
      if (path) {
        update({ quicklook_path: path });
      } else {
        setQlNotFound(true);
      }
    }).catch(() => {
      setDetecting(false);
      setQlNotFound(true);
    });
  };

  const browseQuickLook = async () => {
    const selected = await openFile({
      title: "Select QuickLook.exe",
      filters: [{ name: "QuickLook", extensions: ["exe"] }],
      multiple: false,
    });
    if (selected && typeof selected === "string") {
      update({ quicklook_path: selected });
      setQlNotFound(false);
    }
  };

  const update = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleKeyCapture = () => {
    setCapturingKey(true);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const modifierKeys = ["Control", "Alt", "Shift", "Meta", "CapsLock", "Tab", "Escape", " "];
      if (modifierKeys.includes(e.key)) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      update({ hotkey_key: key });
      setCapturingKey(false);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("keydown", handler);
  };

  const handleSave = () => {
    onSave(settings);
  };

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button onClick={handleSave}>← {t("btn_settings")}</button>
      </div>

      <div className="settings-tabs">
        {(["appearance", "actions", "other", "about"] as Tab[]).map((tKey) => (
          <button
            key={tKey}
            className={`settings-tab ${tab === tKey ? "active" : ""}`}
            onClick={() => setTab(tKey)}
          >
            {t(`settings_tab_${tKey}`)}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {tab === "appearance" && (
          <>
            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_language")}</h3>
                <select
                  value={settings.language}
                  onChange={(e) => update({ language: e.target.value as "zh" | "en" })}
                >
                  <option value="zh">{t("settings_language_zh")}</option>
                  <option value="en">{t("settings_language_en")}</option>
                </select>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_theme")}</h3>
                <select
                  value={settings.theme}
                  onChange={(e) => update({ theme: e.target.value as "light" | "dark" | "system" })}
                >
                  <option value="light">{t("settings_theme_light")}</option>
                  <option value="dark">{t("settings_theme_dark")}</option>
                  <option value="system">{t("settings_theme_system")}</option>
                </select>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_auto_collapse")}</h3>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.auto_collapse}
                    onChange={(e) => update({ auto_collapse: e.target.checked })}
                  />
                  <span className="slider" />
                </label>
              </div>
              <div className="desc">{t("settings_auto_collapse_desc")}</div>
            </div>
          </>
        )}

        {tab === "actions" && (
          <>
            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_hotkey")}</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select style={{ width: 100 }}
                    value={settings.hotkey_modifier}
                    onChange={(e) => update({ hotkey_modifier: e.target.value })}
                  >
                    {Object.entries(MODIFIERS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <span>+</span>
                  <button className="key-capture-btn" onClick={handleKeyCapture}>
                    {capturingKey ? t("settings_hotkey_press") : settings.hotkey_key}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_click_mode")}</h3>
                <select style={{ width: 170 }}
                  value={settings.click_mode}
                  onChange={(e) => update({ click_mode: Number(e.target.value) })}
                >
                  <option value={1}>{t("settings_click_mode_1")}</option>
                  <option value={2}>{t("settings_click_mode_4")}</option>
                  <option value={3}>{t("settings_click_mode_2")}</option>
                  <option value={4}>{t("settings_click_mode_3")}</option>
                </select>
              </div>
            </div>
          </>
        )}

        {tab === "other" && (
          <>
            <div className="settings-card">
              <div className="settings-row">
                <h3>{t("settings_autostart")}</h3>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.autostart}
                    onChange={(e) => update({ autostart: e.target.checked })}
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-row">
                <span>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); openExternal("https://github.com/QL-Win/QuickLook"); }}
                    className="external-link"
                  >
                    {t("settings_quicklook")}
                  </a>
                  <span className="plain-text">{t("settings_quicklook_suffix")}</span>
                </span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.quicklook}
                    onChange={(e) => update({ quicklook: e.target.checked })}
                  />
                  <span className="slider" />
                </label>
              </div>
              {settings.quicklook && (
                <div className="ql-path-row">
                  <div className="ql-path-input-row">
                    <input
                      className="ql-path-input"
                      type="text"
                      value={settings.quicklook_path ?? ""}
                      onChange={(e) => update({ quicklook_path: e.target.value || null })}
                      placeholder={detecting ? t("settings_ql_path_detecting") : "QuickLook.exe"}
                    />
                    <button className="ql-browse-btn" onClick={browseQuickLook}>
                      {t("settings_ql_path_browse")}
                    </button>
                    <button className="ql-browse-btn" onClick={detectQuickLook} disabled={detecting}>
                      {t("settings_ql_path_detect")}
                    </button>
                  </div>
                  {qlNotFound && !detecting && (
                    <div className="ql-not-found-hint">{t("settings_ql_path_not_found")}</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "about" && (
          <div className="about-card">
            <h2>📋 {t("about_title")}</h2>
            <div className="version">{t("about_version")}</div>
            <div className="desc">{t("about_desc")}</div>
            <div className="author">{t("about_author")}</div>
            <div style={{ marginTop: 16 }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openExternal("https://github.com/AUG-Met/Clipz"); }}
                className="external-link"
              >
                {t("about_repo")}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}