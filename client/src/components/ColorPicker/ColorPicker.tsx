import { Check } from "lucide-react";
import { PROFILE_COLORS, type ProfileColor } from "@shared/profiles.ts";
import "./ColorPicker.scss";

export interface ColorPickerProps {
  label: string;
  value: ProfileColor;
  onChange: (color: ProfileColor) => void;
}

/**
 * Choose a profile colour from the fixed set.
 */
export default function ColorPicker(props: ColorPickerProps) {
  const { label, value, onChange } = props;
  return (
    <div className="cn-colors">
      <span className="cn-colors__label">{label}</span>
      <div className="cn-colors__swatches" role="radiogroup" aria-label={label}>
        {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === value}
            aria-label={color}
            className="cn-colors__swatch"
            style={{ background: PROFILE_COLORS[color].bg, color: PROFILE_COLORS[color].fg }}
            onClick={() => onChange(color)}
          >
            {color === value && <Check />}
          </button>
        ))}
      </div>
    </div>
  );
}
