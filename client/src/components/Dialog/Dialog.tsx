import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { X } from "lucide-react";
import cx from "../../lib/cx.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import "./Dialog.scss";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Buttons along the bottom edge.
   */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /**
   * Where the dialog is rendered. Default is the page body; the player passes itself so dialogs show in full screen.
   */
  container?: HTMLElement | null;
}

export default function Dialog(props: DialogProps) {
  const { open, onOpenChange, title, description, children, footer, size = "md", container } = props;
  return (
    <BaseDialog.Root open={open} onOpenChange={(value) => onOpenChange(value)}>
      <BaseDialog.Portal container={container ?? undefined}>
        <BaseDialog.Backdrop className="cn-dialog__backdrop" />
        <BaseDialog.Popup className={cx("cn-dialog", `cn-dialog--${size}`)}>
          <div className="cn-dialog__header">
            <div className="cn-dialog__heading">
              <BaseDialog.Title className="cn-dialog__title">{title}</BaseDialog.Title>
              {description && <BaseDialog.Description className="cn-dialog__description">{description}</BaseDialog.Description>}
            </div>
            <BaseDialog.Close render={<IconButton label="Close" icon={<X />} size="sm" />} />
          </div>
          {children && <div className="cn-dialog__body">{children}</div>}
          {footer && <div className="cn-dialog__footer">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /**
   * Style the confirm button as destructive.
   */
  danger?: boolean;
  loading?: boolean;
}

/**
 * Ask before doing something that can't be undone.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onOpenChange, title, description, confirmLabel, onConfirm, danger = false, loading = false } = props;
  return (
    <AlertDialog.Root open={open} onOpenChange={(value) => onOpenChange(value)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="cn-dialog__backdrop" />
        <AlertDialog.Popup className="cn-dialog cn-dialog--sm">
          <div className="cn-dialog__header">
            <div className="cn-dialog__heading">
              <AlertDialog.Title className="cn-dialog__title">{title}</AlertDialog.Title>
              <AlertDialog.Description className="cn-dialog__description">{description}</AlertDialog.Description>
            </div>
          </div>
          <div className="cn-dialog__footer">
            <AlertDialog.Close render={<Button variant="ghost">Cancel</Button>} />
            <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={() => onConfirm()}>{confirmLabel}</Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
