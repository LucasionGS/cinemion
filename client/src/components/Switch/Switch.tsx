import type { ReactNode } from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import "./Switch.scss";

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export default function Switch(props: SwitchProps) {
  const { label, description, checked, onChange, disabled = false } = props;
  return (
    <label className="cn-switch">
      <span className="cn-switch__text">
        <span className="cn-switch__label">{label}</span>
        {description && <span className="cn-switch__description">{description}</span>}
      </span>
      <BaseSwitch.Root className="cn-switch__root" checked={checked} onCheckedChange={(value) => onChange(value)} disabled={disabled}>
        <BaseSwitch.Thumb className="cn-switch__thumb" />
      </BaseSwitch.Root>
    </label>
  );
}
