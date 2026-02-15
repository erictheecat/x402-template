import { request } from "undici";

import { AppError } from "./errors.js";

export async function headRequest(url: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await request(url, {
      method: "HEAD",
      signal: controller.signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    if (response.statusCode >= 500) {
      throw new AppError(503, "NOT_READY", `Upstream unhealthy: ${response.statusCode}`);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "NOT_READY", "Upstream check failed");
  } finally {
    clearTimeout(timeout);
  }
}
