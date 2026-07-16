const logs = [];

export function log(level, message, data = null) {
  const entry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    level,
    message,
    data,
  };

  logs.unshift(entry);

  if (logs.length > 1000) {
    logs.pop();
  }

  const consoleFn = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[consoleFn](
    `[${entry.time}] [${level.toUpperCase()}] ${message}`,
    data ?? ""
  );

  if (window.api?.log) {
    window.api.log(entry);
  }

  return entry;
}

export function getLogs() {
  return logs;
}
