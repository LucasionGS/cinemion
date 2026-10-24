import { i18n, t } from "../i18n/I18n.ts";

/**
 * "512 KB", "3.4 GB" or "7.2 TB".
 */
export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return t("format.bytes.kb", { value: Math.round(bytes / 1024) });
  if (bytes < 1024 ** 3) return t("format.bytes.mb", { value: decimal(bytes / 1024 ** 2) });
  if (bytes < 1024 ** 4) return t("format.bytes.gb", { value: decimal(bytes / 1024 ** 3) });
  return t("format.bytes.tb", { value: decimal(bytes / 1024 ** 4) });
}

/**
 * A number with one decimal, written the language's way ("3.4", or "3,4" in German).
 */
function decimal(value: number) {
  return value.toLocaleString(i18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * "41 Mbps" or "800 kbps", from bits per second.
 */
export function formatBitrate(bitsPerSecond: number) {
  if (bitsPerSecond < 1_000_000) return t("format.bitrate.kbps", { value: Math.round(bitsPerSecond / 1000) });
  const mbps = bitsPerSecond / 1_000_000;
  return t("format.bitrate.mbps", { value: mbps < 10 ? Math.round(mbps * 10) / 10 : Math.round(mbps) });
}

/**
 * "just now", "5 min ago", "3 hours ago" or "2 days ago".
 */
export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t("format.ago.justNow");
  if (minutes < 60) return t("format.ago.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("format.ago.hours", { count: hours });
  return t("format.ago.days", { count: Math.round(hours / 24) });
}

/**
 * "soon", "in 12 min", "in 4 hours" or "Wed 03:00".
 */
export function timeUntil(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (minutes < 1) return t("format.until.soon");
  if (minutes < 60) return t("format.until.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("format.until.hours", { count: hours });
  return new Date(iso).toLocaleString(i18n.locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * How long something has been going: "12 minutes", "3 hours" or "6 days".
 */
export function formatSpan(fromIso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000));
  if (minutes < 1) return t("format.span.underAMinute");
  if (minutes < 60) return t("format.span.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("format.span.hours", { count: hours });
  return t("format.span.days", { count: Math.floor(hours / 24) });
}

/**
 * "12 July 2024", from `YYYY-MM-DD`. With `short`, "12 Jul 2024".
 */
export function formatDate(date: string, short = false) {
  const [y, m, d] = date.split("-").map(Number);
  // Built from parts: new Date("2024-07-12") is midnight UTC, which is the day before in the Americas
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(i18n.locale, { day: "numeric", month: short ? "short" : "long", year: "numeric" });
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
  if (sameYear && a.getMonth() === b.getMonth()) return t("format.dateRange", { from: a.toLocaleDateString(i18n.locale, { day: "numeric" }), to: formatDate(to) });
  if (sameYear) return t("format.dateRange", { from: a.toLocaleDateString(i18n.locale, { day: "numeric", month: "long" }), to: formatDate(to) });
  return t("format.dateRange", { from: formatDate(from, true), to: formatDate(to, true) });
}

/**
 * "Saturday 13 July 2024, 14:32", from `YYYY-MM-DDTHH:MM:SS` on the camera's clock. Shown as written, without
 * moving it into this device's time zone. With `short`, "13 Jul 2024, 14:32".
 */
export function formatDateTime(value: string, short = false) {
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number);
  const date = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
  const day = date.toLocaleDateString(i18n.locale, short ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t("format.dateTime", { date: day, time: date.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" }) });
}

/**
 * "13 Jul 2024, 14:32" for a moment in time (an ISO string with its time zone), in this device's time zone. Without
 * `short`, the day and month are written out.
 */
export function formatMoment(iso: string, short = true) {
  const date = new Date(iso);
  const day = date.toLocaleDateString(i18n.locale, short ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t("format.dateTime", { date: day, time: date.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" }) });
}

/**
 * "34%", from 0 to 1.
 */
export function formatPercent(value: number) {
  return value.toLocaleString(i18n.locale, { style: "percent", maximumFractionDigits: 0 });
}
