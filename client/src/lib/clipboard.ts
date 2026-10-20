/**
 * Copy text to the clipboard. Browsers only offer the Clipboard API on https and localhost, and Cinemion is
 * often opened over plain http on the home network, so this falls back to the older copy command.
 * @returns Whether it worked.
 */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export default copyText;
