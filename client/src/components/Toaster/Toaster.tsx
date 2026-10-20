import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import "./Toaster.scss";

const ICONS = {
  info: <Info />,
  success: <CircleCheck />,
  error: <CircleAlert />,
};

/**
 * Shows the messages from `toasts`. Mounted once at the app root.
 */
export default function Toaster() {
  const { toasts: list } = useController(toasts);
  return (
    <div className="cn-toaster" role="region" aria-label="Notifications" aria-live="polite">
      {list.map((toast) => (
        <div key={toast.id} className={cx("cn-toast", `cn-toast--${toast.type}`)} role={toast.type === "error" ? "alert" : "status"}>
          <span className="cn-toast__icon">{ICONS[toast.type]}</span>
          <div className="cn-toast__text">
            <strong>{toast.title}</strong>
            {toast.description && <span>{toast.description}</span>}
          </div>
          <button type="button" className="cn-toast__close" aria-label="Dismiss" tabIndex={-1} onClick={() => toasts.dismiss(toast.id)}><X /></button>
        </div>
      ))}
    </div>
  );
}
