import { t } from "../i18n";

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A reliable in-app confirmation dialog (native window.confirm is
 *  unreliable in the Tauri WebView, especially when called back-to-back). */
export function ConfirmDialog({ message, onConfirm, onCancel }: Props) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-message">{message}</div>
        <div className="confirm-actions">
          <button className="btn btn-cancel" onClick={onCancel}>
            {t("confirm_cancel")}
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {t("confirm_ok")}
          </button>
        </div>
      </div>
    </div>
  );
}