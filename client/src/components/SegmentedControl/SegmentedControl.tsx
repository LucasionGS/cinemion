import type { ReactNode } from "react";
import cx from "../../lib/cx.ts";
import "./SegmentedControl.scss";

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}

export default function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const { label, value, options, onChange } = props;
  return (
    <div className="cn-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx("cn-segmented__option", o.value === value && "cn-segmented__option--active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
