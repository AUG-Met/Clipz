export interface HistoryItem {
  id: number;
  type: "text" | "image" | "file" | "files";
  text_value: string | null;
  image_path: string | null;
  thumbnail_path: string | null;
  md5_hash: string | null;
  created_at: string;
}

export interface AppSettings {
  language: "zh" | "en";
  theme: "light" | "dark" | "system";
  hotkey_modifier: string;
  hotkey_key: string;
  click_mode: number;
  autostart: boolean;
  quicklook: boolean;
}

export type ClickMode = 1 | 2 | 3 | 4;
// 1: Single click to copy
// 2: Single click to copy & close
// 3: Single select, double click to copy
// 4: Double click to copy & close