import type { LogEntry, LogLevel } from "@shared/admin.ts";

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

/**
 * Lines kept in memory for the Logs page.
 */
const BUFFER_SIZE = 1000;
const _buffer: LogEntry[] = [];
let _nextId = 1;

function write(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const now = new Date();
  const json = data && Object.keys(data).length > 0 ? JSON.stringify(data, (_key, value) => value instanceof Error ? value.message : value) : null;
  const line = `${COLORS[level]}${now.toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)}\x1b[0m ${message}${json ? " " + json : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  _buffer.push({ id: _nextId++, time: now.toISOString(), level, message, data: json });
  if (_buffer.length > BUFFER_SIZE) _buffer.splice(0, _buffer.length - BUFFER_SIZE);
}

/**
 * Small leveled logger for the server. `data` is printed as JSON after the message.
 */
export const log = {
  debug: (message: string, data?: Record<string, unknown>) => {
    if (Deno.env.get("DEBUG")) write("debug", message, data);
  },
  info: (message: string, data?: Record<string, unknown>) => write("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => write("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => write("error", message, data),

  /**
   * The last lines logged, oldest first. With `after`, only lines newer than that id. An `after` past the newest
   * line comes from before a restart, so it gets every line.
   */
  recent: (after = 0): LogEntry[] => _buffer.filter((e) => e.id > (after >= _nextId ? 0 : after)),
};

export default log;
