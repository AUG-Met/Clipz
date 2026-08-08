import { t } from "../i18n";

interface Props {
  count: number;
  onSettings: () => void;
  onClear: () => void;
}

export function BottomBar({ count, onSettings, onClear }: Props) {
  return (
    <div className="bottom-bar">
      <div className="count">{t("count_records", { n: count })}</div>
      <div className="actions">
        <button className="btn-ghost" onClick={onSettings}>
          ⚙ {t("btn_settings")}
        </button>
        <button className="btn-ghost danger" onClick={onClear}>
          🗑 {t("btn_clear")}
        </button>
      </div>
    </div>
  );
}