import { Delete } from "lucide-react";
import cx from "../../lib/cx.ts";
import "./PinPad.scss";

export interface PinPadProps {
  /**
   * Digits entered so far.
   */
  value: string;
  length?: number;
  onDigit: (digit: string) => void;
  onDelete: () => void;
  /**
   * Shakes the dots, e.g. after a wrong PIN.
   */
  error?: boolean;
  disabled?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];

export default function PinPad(props: PinPadProps) {
  const { value, length = 4, onDigit, onDelete, error = false, disabled = false } = props;
  return (
    <div className="cn-pinpad">
      <div className={cx("cn-pinpad__dots", error && "cn-pinpad__dots--error")} aria-live="polite" aria-label={`${value.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => <span key={i} className={cx("cn-pinpad__dot", i < value.length && "cn-pinpad__dot--filled")} />)}
      </div>
      <div className="cn-pinpad__keys">
        {KEYS.map((key, i) => {
          if (key === "") return <span key={i} />;
          if (key === "delete") {
            return <button key={i} type="button" className="cn-pinpad__key cn-pinpad__key--ghost" aria-label="Delete" onClick={onDelete} disabled={disabled}><Delete /></button>;
          }
          return <button key={i} type="button" className="cn-pinpad__key" onClick={() => onDigit(key)} disabled={disabled} data-autofocus={key === "1" || undefined}>{key}</button>;
        })}
      </div>
    </div>
  );
}
