import type { ButtonHTMLAttributes, ReactNode } from "react";
import cx from "../../lib/cx.ts";
import Spinner from "../Spinner/Spinner.tsx";
import "./Button.scss";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  /**
   * Shows a spinner and blocks clicks while an action runs.
   */
  loading?: boolean;
  /**
   * Stretch to the full width of the parent.
   */
  block?: boolean;
}

export default function Button(props: ButtonProps) {
  const { variant = "secondary", size = "md", icon, loading = false, block = false, className, children, disabled, type = "button", ...rest } = props;
  return (
    <button
      type={type}
      className={cx("cn-button", `cn-button--${variant}`, `cn-button--${size}`, block && "cn-button--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="1.1em" /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}
