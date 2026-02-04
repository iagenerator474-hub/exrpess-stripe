type LogLevel = "info" | "warn" | "error" | "debug";

interface LogPayload {
  level: LogLevel;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

function formatPayload(p: LogPayload): string {
  return JSON.stringify({
    ...p,
    timestamp: new Date().toISOString(),
  });
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(formatPayload({ level: "info", message, ...meta }));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(formatPayload({ level: "warn", message, ...meta }));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(formatPayload({ level: "error", message, ...meta }));
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(formatPayload({ level: "debug", message, ...meta }));
    }
  },
};
