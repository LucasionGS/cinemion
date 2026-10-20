/**
 * Join class names, skipping falsy ones: `cx("button", isActive && "button--active")`.
 */
export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(" ");
}

export default cx;
