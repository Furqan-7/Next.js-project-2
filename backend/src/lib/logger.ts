type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min: Level = process.env.NODE_ENV === "test" ? "error" : ((process.env.LOG_LEVEL as Level) ?? "info");

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < order[min]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  (level === "error" ? console.error : console.log)(line);
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
};
