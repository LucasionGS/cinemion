import { type ReactNode, type SelectHTMLAttributes, useId } from "react";
import cx from "../../lib/cx.ts";
import "../TextField/TextField.scss";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  description?: ReactNode;
  options: { value: string; label: string }[];
}

/**
 * A native select styled like the text fields. Native, so TV remotes and phones get their own pickers.
 */
export default function Select(props: SelectProps) {
  const { label, description, options, className, style, id: givenId, ...rest } = props;
  const generatedId = useId();
  const id = givenId ?? generatedId;
  return (
    <div className={cx("cn-field", className)} style={style}>
      <label className="cn-field__label" htmlFor={id}>{label}</label>
      <select id={id} className="cn-field__input" aria-describedby={description ? `${id}-description` : undefined} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {description && <span id={`${id}-description`} className="cn-field__description">{description}</span>}
    </div>
  );
}
