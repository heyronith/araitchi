import "server-only";

/** App listen port (dev/start scripts use 3000). */
export function getAppPort(): number {
  const raw = process.env.PORT?.trim();
  if (!raw) {
    return 3000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

export function getLocalAppOrigin(): string {
  return `http://127.0.0.1:${getAppPort()}`;
}

export function getLocalhostAppOrigin(): string {
  return `http://localhost:${getAppPort()}`;
}
