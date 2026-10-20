type Level = "debug" | "info" | "warn" | "error";

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

function write(level: Level, message: string, data?: Record<string, unknown>) {
  const time = new Date().toISOString().slice(11, 19);
  const extra = data && Object.keys(data).length > 0 ? " " + JSON.stringify(data, (_key, value) => value instanceof Error ? value.message : value) : "";
  const line = `${COLORS[level]}${time} ${level.toUpperCase().padEnd(5)}\x1b[0m ${message}${extra}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
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
};

export default log;
