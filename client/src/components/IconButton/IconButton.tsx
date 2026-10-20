import type { ButtonHTMLAttributes, ReactNode } from "react";
import cx from "../../lib/cx.ts";
import "./IconButton.scss";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Read out by screen readers, since the button has no visible text.
   */
  label: string;
  icon: ReactNode;
  variant?: "glass" | "ghost";
  size?: "sm" | "md" | "lg";
}

export default function IconButton(props: IconButtonProps) {
  const { label, icon, variant = "glass", size = "md", className, type = "button", ...rest } = props;
  return (
    <button type={type} aria-label={label} title={label} className={cx("cn-icon-button", `cn-icon-button--${variant}`, `cn-icon-button--${size}`, className)} {...rest}>
      {icon}
    </button>
  );
}
