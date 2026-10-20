import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import cx from "../../lib/cx.ts";
import "./TextField.scss";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
}

export default function TextField(props: TextFieldProps) {
  const { label, description, error, className, style, id: givenId, ...rest } = props;
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const describedBy = [description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("cn-field", error && "cn-field--invalid", className)} style={style}>
      <label className="cn-field__label" htmlFor={id}>{label}</label>
      <input id={id} className="cn-field__input" aria-invalid={!!error || undefined} aria-describedby={describedBy} {...rest} />
      {description && <span id={`${id}-description`} className="cn-field__description">{description}</span>}
      {error && <span id={`${id}-error`} className="cn-field__error" role="alert">{error}</span>}
    </div>
  );
}
