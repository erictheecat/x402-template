import { parse as parseQuery } from "node:querystring";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface ExpressLikeRequest extends IncomingMessage {
  path?: string;
  protocol?: string;
  originalUrl?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  header?: (name: string) => string | undefined;
}

export interface ExpressLikeResponse extends ServerResponse {
  status?: (code: number) => ExpressLikeResponse;
  json?: (body: unknown) => ExpressLikeResponse;
  send?: (body: unknown) => ExpressLikeResponse;
}

function getPathFromUrl(url: string): string {
  const [path] = url.split("?");
  return path || "/";
}

function getProtocol(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") return forwardedProto.split(",")[0]?.trim() || "http";

  const encrypted = (req.socket as { encrypted?: boolean }).encrypted;
  return encrypted ? "https" : "http";
}

export function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function getIp(req: IncomingMessage): string {
  const forwarded = getHeader(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  return req.socket.remoteAddress || "unknown";
}

export function adaptExpressLikeRequest(req: IncomingMessage): ExpressLikeRequest {
  const target = req as ExpressLikeRequest;
  const originalUrl = req.url ?? "/";

  if (!target.originalUrl) target.originalUrl = originalUrl;
  if (!target.path) target.path = getPathFromUrl(originalUrl);
  if (!target.protocol) target.protocol = getProtocol(req);
  if (!target.query) target.query = parseQuery(originalUrl.split("?")[1] ?? "");
  if (!target.header) target.header = (name: string) => getHeader(req, name);

  return target;
}

export function adaptExpressLikeResponse(res: ServerResponse): ExpressLikeResponse {
  const target = res as ExpressLikeResponse;

  if (!target.status) {
    target.status = (code: number) => {
      target.statusCode = code;
      return target;
    };
  }

  if (!target.send) {
    target.send = (body: unknown) => {
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        target.end(body);
      } else if (body === undefined || body === null) {
        target.end();
      } else {
        if (!target.hasHeader("content-type")) {
          target.setHeader("content-type", "application/json; charset=utf-8");
        }
        target.end(JSON.stringify(body));
      }
      return target;
    };
  }

  if (!target.json) {
    target.json = (body: unknown) => {
      if (!target.hasHeader("content-type")) {
        target.setHeader("content-type", "application/json; charset=utf-8");
      }
      target.end(JSON.stringify(body));
      return target;
    };
  }

  return target;
}
