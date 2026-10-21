/**
 * "512 KB", "3.4 GB" or "7.2 TB".
 */
export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

/**
 * "41 Mbps" or "800 kbps", from bits per second.
 */
export function formatBitrate(bitsPerSecond: number) {
  if (bitsPerSecond < 1_000_000) return `${Math.round(bitsPerSecond / 1000)} kbps`;
  const mbps = bitsPerSecond / 1_000_000;
  return `${mbps < 10 ? Math.round(mbps * 10) / 10 : Math.round(mbps)} Mbps`;
}

/**
 * "just now", "5 min ago", "3 hours ago" or "2 days ago".
 */
export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * "soon", "in 12 min", "in 4 hours" or "Wed 03:00".
 */
export function timeUntil(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes < 1) return "soon";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * How long something has been going: "12 minutes", "3 hours" or "6 days".
 */
export function formatSpan(fromIso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * "12 July 2024", from `YYYY-MM-DD`. With `short`, "12 Jul 2024".
 */
export function formatDate(date: string, short = false) {
  const [y, m, d] = date.split("-").map(Number);
  // Built from parts: new Date("2024-07-12") is midnight UTC, which is the day before in the Americas
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { day: "numeric", month: short ? "short" : "long", year: "numeric" });
}

/**
 * A span of days, as short as it can be said: "12 July 2024", "12 – 26 July 2024", "30 June – 2 July 2024" or
 * "30 Dec 2024 – 2 Jan 2025", from `YYYY-MM-DD` dates.
 */
export function formatDateRange(from: string, to: string) {
  if (from === to) return formatDate(from);
  const date = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const [a, b] = [date(from), date(to)];
  const sameYear = a.getFullYear() === b.getFullYear();
  if (sameYear && a.getMonth() === b.getMonth()) return `${a.getDate()} – ${formatDate(to)}`;
  if (sameYear) return `${a.toLocaleDateString(undefined, { day: "numeric", month: "long" })} – ${formatDate(to)}`;
  return `${formatDate(from, true)} – ${formatDate(to, true)}`;
}

/**
 * "Saturday 13 July 2024, 14:32", from `YYYY-MM-DDTHH:MM:SS` on the camera's clock. Shown as written, without
 * moving it into this device's time zone. With `short`, "13 Jul 2024, 14:32".
 */
export function formatDateTime(value: string, short = false) {
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number);
  const date = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
  const day = date.toLocaleDateString(undefined, short ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * "34%", from 0 to 1.
 */
export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
