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
  quicklook_path: string | null;
  auto_collapse: boolean;
  auto_paste: boolean;
  auto_paste_close: boolean;
}

export type ClickMode = 1 | 2 | 3 | 4;
// 1: Single click to copy
// 2: Single click to copy & close
// 3: Single select, double click to copy
// 4: Double click to copy & close

export type Category =
  | "all"
  | "favorites"
  | "text"
  | "links"
  | "documents"
  | "media"
  | "other";

/** A favorite record: an item, or a specific file within an item. */
export interface FavoriteEntry {
  item_id: number;
  file_path: string | null;
}