import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { errors, request } from "undici";

import { AppError } from "./errors.js";

const EXTRACT_TIMEOUT_MS = 5_000;
const NOISE_SELECTORS = "script, style, nav, footer, noscript, template, svg, form, iframe";
const LAYOUT_SELECTORS = "header, aside";
const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

export interface ExtractOptions {
  includeLinks?: boolean;
  includeImages?: boolean;
}

export interface ExtractedContent {
  title: string;
  text: string;
  description: string;
  links: string[];
  images?: string[];
  wordCount: number;
  language: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function countWords(value: string): number {
  if (!value) return 0;
  return value.split(/\s+/).filter(Boolean).length;
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function parseUrl(input: string): URL {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new AppError(400, "INVALID_URL", "URL must be a valid http(s) URL");
  }
}

function isHtmlContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return HTML_CONTENT_TYPES.some((candidate) => normalized.includes(candidate));
}

function selectContentRoot($: CheerioAPI): Cheerio<AnyNode> {
  const selectors = ["main", "article", "[role='main']"];

  for (const selector of selectors) {
    const match = $(selector).first();
    if (match.length > 0) {
      return match;
    }
  }

  return $("body").first();
}

function extractLanguage($: CheerioAPI): string {
  const htmlLang = $("html").attr("lang");
  if (htmlLang) {
    return htmlLang.split(/[-_]/)[0]?.toLowerCase() ?? "unknown";
  }

  const ogLocale = $('meta[property="og:locale"]').attr("content");
  if (ogLocale) {
    return ogLocale.split(/[-_]/)[0]?.toLowerCase() ?? "unknown";
  }

  return "unknown";
}

function resolveAssetUrls(elements: Cheerio<AnyNode>, pageUrl: URL, attribute: "href" | "src"): string[] {
  const values = new Set<string>();

  elements.each((_, element) => {
    if (!("attribs" in element) || !element.attribs) {
      return;
    }

    const raw = element.attribs[attribute];
    if (!raw) return;

    try {
      const resolved = new URL(raw, pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        values.add(resolved.toString());
      }
    } catch {
      // Ignore malformed asset URLs from upstream pages.
    }
  });

  return [...values];
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof errors.HeadersTimeoutError ||
    error instanceof errors.BodyTimeoutError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export async function extractWebContent(inputUrl: string, options: ExtractOptions = {}): Promise<ExtractedContent> {
  const pageUrl = parseUrl(inputUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const response = await request(pageUrl, {
      method: "GET",
      signal: controller.signal,
      headersTimeout: EXTRACT_TIMEOUT_MS,
      bodyTimeout: EXTRACT_TIMEOUT_MS,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "x402-template/1.0",
      },
    });

    if (response.statusCode >= 400) {
      throw new AppError(502, "INTERNAL_ERROR", `Upstream fetch failed with status ${response.statusCode}`);
    }

    const contentType = getHeaderValue(response.headers["content-type"]);
    if (!isHtmlContentType(contentType)) {
      throw new AppError(415, "UNSUPPORTED_CONTENT_TYPE", "Upstream response must be HTML");
    }

    const html = await response.body.text();
    const $ = load(html);

    $(NOISE_SELECTORS).remove();
    $(LAYOUT_SELECTORS).remove();

    const root = selectContentRoot($);
    const text = normalizeWhitespace(root.text() || $("body").text());
    const title =
      normalizeWhitespace($("title").first().text()) ||
      normalizeWhitespace(root.find("h1").first().text()) ||
      pageUrl.hostname;
    const description = normalizeWhitespace(
      $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
    );
    const links = options.includeLinks ? resolveAssetUrls(root.find("a[href]"), pageUrl, "href") : [];

    const result: ExtractedContent = {
      title,
      text,
      description,
      links,
      wordCount: countWords(text),
      language: extractLanguage($),
    };

    if (options.includeImages) {
      result.images = resolveAssetUrls(root.find("img[src]"), pageUrl, "src");
    }

    return result;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isTimeoutError(error)) {
      throw new AppError(504, "UPSTREAM_TIMEOUT", "Upstream fetch timed out");
    }

    throw new AppError(502, "INTERNAL_ERROR", "Upstream fetch failed");
  } finally {
    clearTimeout(timeout);
  }
}
