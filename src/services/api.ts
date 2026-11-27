const BASE = `${(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "")}/api/v1`;
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  code: string;
  details: unknown;
  requestId: string | null;
  status: number;

  constructor(
    message: string,
    code: string,
    status: number,
    details: unknown,
    requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<{ data: T; requestId: string | null }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const requestId = response.headers.get("X-Request-ID");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const envelope = payload as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (response.status === 401) {
        accessToken = null;
        onUnauthorized?.();
      }
      throw new ApiError(
        envelope.error?.message || "The request could not be completed.",
        envelope.error?.code || "unknown_error",
        response.status,
        envelope.error?.details,
        requestId,
      );
    }
    return { data: payload as T, requestId };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request took too long. Please try again.", "timeout", 0, null, null);
    }
    throw new ApiError(
      "Could not connect to the server. Check your connection and try again.",
      "network_error",
      0,
      null,
      null,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function apiDownload(
  path: string,
  filename: string,
  openInline = false,
): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  try {
    const response = await fetch(`${BASE}${path}`, { headers, signal: controller.signal });
    const requestId = response.headers.get("X-Request-ID");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const envelope = payload as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (response.status === 401) {
        accessToken = null;
        onUnauthorized?.();
      }
      throw new ApiError(
        envelope.error?.message || "Could not download file.",
        envelope.error?.code || "download_error",
        response.status,
        envelope.error?.details,
        requestId,
      );
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (openInline) {
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Download timed out. Please try again.", "timeout", 0, null, null);
    }
    throw new ApiError("Could not download file.", "network_error", 0, null, null);
  } finally {
    window.clearTimeout(timeout);
  }
}
