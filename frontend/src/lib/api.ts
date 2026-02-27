export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export class ApiError extends Error {
  status: number;
  payload: JsonValue | null;

  constructor(message: string, status: number, payload: JsonValue | null = null) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function parseResponse(res: Response): Promise<JsonValue | null> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export async function apiFetch<T = JsonValue>(
  path: string,
  init: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status, payload);
  }

  return payload as T;
}
