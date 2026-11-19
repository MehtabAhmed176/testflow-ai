export const API_BASE = "http://localhost:4000/api";

export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage: string;
  constructor(status: number, serverMessage: string, details = "") {
    super([serverMessage, details].filter(Boolean).join(": "));
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${API_BASE}${path}`, options); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Could not reach the API. Check the backend and your connection, then retry.", { cause: error });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const details = Array.isArray(data?.errors)
      ? data.errors.map((issue: { path?: (string | number)[]; message?: string }) =>
          `${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message ?? "Validation failed"}`).join("; ")
      : "";
    throw new ApiError(response.status, data?.message || `Request failed (${response.status})`, details);
  }
  if (data === null) throw new Error("The API returned an invalid JSON response.");
  return data as T;
}
