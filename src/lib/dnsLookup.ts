import { Resolver, lookup } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { domainToASCII } from "node:url";

import { AppError } from "./errors.js";

export const DNS_ROUTE_PRICE_USDC = "0.003";
export const DNS_ROUTE_PRICE_BASE_UNITS = "3000";
export const DNS_LOOKUP_TIMEOUT_MS = 3_000;
export const SUPPORTED_DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"] as const;

export type DnsRecordType = (typeof SUPPORTED_DNS_RECORD_TYPES)[number];

export interface DnsMxRecord {
  priority: number;
  exchange: string;
}

export interface DnsSoaRecord {
  nsname: string;
  hostmaster: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minttl: number;
}

export interface DnsSslSummary {
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
}

export interface DnsRecords {
  A?: string[];
  AAAA?: string[];
  CNAME?: string[];
  MX?: DnsMxRecord[];
  TXT?: string[];
  NS?: string[];
  SOA?: DnsSoaRecord | null;
}

export interface DomainIntelligenceResult {
  domain: string;
  records: DnsRecords;
  ssl: DnsSslSummary | null;
}

export interface DnsLookupDeps {
  timeoutMs: number;
  now: () => Date;
  resolveRecord: (domain: string, recordType: DnsRecordType) => Promise<unknown>;
  inspectCertificate: (domain: string, timeoutMs: number) => Promise<DnsSslSummary | null>;
}

type DnsRecordValue = DnsRecords[keyof DnsRecords];

function createDefaultDeps(now: () => Date): DnsLookupDeps {
  const resolver = new Resolver();

  return {
    timeoutMs: DNS_LOOKUP_TIMEOUT_MS,
    now,
    resolveRecord: async (domain, recordType) => {
      switch (recordType) {
        case "A":
          return (await lookup(domain, { all: true, family: 4 })).map(({ address }) => address);
        case "AAAA":
          return (await lookup(domain, { all: true, family: 6 })).map(({ address }) => address);
        case "CNAME":
          return resolver.resolveCname(domain);
        case "MX":
          return resolver.resolveMx(domain);
        case "TXT":
          return resolver.resolveTxt(domain);
        case "NS":
          return resolver.resolveNs(domain);
        case "SOA":
          return resolver.resolveSoa(domain);
      }
    },
    inspectCertificate: (domain, timeoutMs) => inspectTlsCertificate(domain, timeoutMs, now),
  };
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim().replace(/\.+$/u, "");
  const normalized = domainToASCII(trimmed).toLowerCase();

  if (!normalized || normalized.length > 253) {
    throw new AppError(400, "INVALID_DOMAIN", "Domain must be a valid hostname");
  }

  const labels = normalized.split(".");
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
  if (labels.some((label) => !labelPattern.test(label))) {
    throw new AppError(400, "INVALID_DOMAIN", "Domain must be a valid hostname");
  }

  return normalized;
}

function normalizeRecordTypes(recordTypes: DnsRecordType[]): DnsRecordType[] {
  if (recordTypes.length === 0) {
    throw new AppError(400, "INVALID_DOMAIN", "At least one DNS record type is required");
  }

  return [...new Set(recordTypes)];
}

function setRecordValue(records: DnsRecords, recordType: DnsRecordType, value: DnsRecordValue): void {
  switch (recordType) {
    case "A":
      records.A = value as string[];
      return;
    case "AAAA":
      records.AAAA = value as string[];
      return;
    case "CNAME":
      records.CNAME = value as string[];
      return;
    case "MX":
      records.MX = value as DnsMxRecord[];
      return;
    case "TXT":
      records.TXT = value as string[];
      return;
    case "NS":
      records.NS = value as string[];
      return;
    case "SOA":
      records.SOA = value as DnsSoaRecord | null;
      return;
  }
}

function emptyRecordValue(recordType: DnsRecordType): DnsRecordValue {
  if (recordType === "SOA") {
    return null;
  }

  return [];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry));
}

function normalizeRecordValue(recordType: DnsRecordType, value: unknown): DnsRecordValue {
  switch (recordType) {
    case "A":
    case "AAAA":
    case "CNAME":
    case "NS":
      return normalizeStringArray(value);
    case "MX":
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .map((entry) => {
          const mx = entry as Partial<DnsMxRecord>;
          return {
            priority: Number(mx.priority ?? 0),
            exchange: String(mx.exchange ?? ""),
          };
        })
        .filter((entry) => entry.exchange.length > 0);
    case "TXT":
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .map((entry) => (Array.isArray(entry) ? entry.map((part) => String(part)).join("") : String(entry)))
        .filter(Boolean);
    case "SOA":
      if (!value || typeof value !== "object") {
        return null;
      }

      return {
        nsname: String((value as Partial<DnsSoaRecord>).nsname ?? ""),
        hostmaster: String((value as Partial<DnsSoaRecord>).hostmaster ?? ""),
        serial: Number((value as Partial<DnsSoaRecord>).serial ?? 0),
        refresh: Number((value as Partial<DnsSoaRecord>).refresh ?? 0),
        retry: Number((value as Partial<DnsSoaRecord>).retry ?? 0),
        expire: Number((value as Partial<DnsSoaRecord>).expire ?? 0),
        minttl: Number((value as Partial<DnsSoaRecord>).minttl ?? 0),
      };
  }
}

function hasRecordData(value: DnsRecordValue): boolean {
  if (value == null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function isErrorWithCode(error: unknown): error is Error & { code?: string } {
  return error instanceof Error;
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof AppError && error.code === "DNS_TIMEOUT") {
    return true;
  }

  return isErrorWithCode(error) && ["ETIMEOUT", "ESOCKETTIMEDOUT"].includes(error.code ?? "");
}

function isNotFoundError(error: unknown): boolean {
  return isErrorWithCode(error) && error.code === "ENOTFOUND";
}

function isNoDataError(error: unknown): boolean {
  return isErrorWithCode(error) && ["ENODATA", "ENOTIMP", "ESERVFAIL", "EREFUSED"].includes(error.code ?? "");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError(504, "DNS_TIMEOUT", message)), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function formatCertificateDate(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function deriveIssuer(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "Unknown";
  }

  const issuer = value as Record<string, unknown>;
  return String(issuer.O ?? issuer.CN ?? Object.values(issuer)[0] ?? "Unknown");
}

function isTlsUnavailableError(error: unknown): boolean {
  return (
    isErrorWithCode(error) &&
    ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "EPROTO", "ERR_SSL_WRONG_VERSION_NUMBER"].includes(
      error.code ?? "",
    )
  );
}

function inspectTlsCertificate(domain: string, timeoutMs: number, now: () => Date): Promise<DnsSslSummary | null> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: domain,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
    });

    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      callback();
    };

    socket.setTimeout(timeoutMs);

    socket.once("secureConnect", () => {
      try {
        const certificate = socket.getPeerCertificate();
        socket.end();

        if (!certificate || Object.keys(certificate).length === 0) {
          finish(() => resolve(null));
          return;
        }

        const validFrom = formatCertificateDate(String(certificate.valid_from ?? ""));
        const validTo = formatCertificateDate(String(certificate.valid_to ?? ""));
        if (!validFrom || !validTo) {
          finish(() => resolve(null));
          return;
        }

        const daysRemaining = Math.max(
          0,
          Math.ceil((new Date(validTo).getTime() - now().getTime()) / (24 * 60 * 60 * 1000)),
        );

        finish(() =>
          resolve({
            issuer: deriveIssuer(certificate.issuer),
            validFrom,
            validTo,
            daysRemaining,
          }),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });

    socket.once("timeout", () => {
      socket.destroy();
      finish(() => reject(new AppError(504, "DNS_TIMEOUT", "TLS inspection timed out")));
    });

    socket.once("error", (error) => {
      socket.destroy();

      if (isTlsUnavailableError(error)) {
        finish(() => resolve(null));
        return;
      }

      if (isTimeoutError(error)) {
        finish(() => reject(new AppError(504, "DNS_TIMEOUT", "TLS inspection timed out")));
        return;
      }

      finish(() => reject(error));
    });
  });
}

export async function lookupDomainIntelligence(
  inputDomain: string,
  requestedRecordTypes: DnsRecordType[],
  deps?: Partial<DnsLookupDeps>,
): Promise<DomainIntelligenceResult> {
  const now = deps?.now ?? (() => new Date());
  const resolvedDeps: DnsLookupDeps = {
    ...createDefaultDeps(now),
    ...deps,
    timeoutMs: deps?.timeoutMs ?? DNS_LOOKUP_TIMEOUT_MS,
    now,
  };

  const domain = normalizeDomain(inputDomain);
  const recordTypes = normalizeRecordTypes(requestedRecordTypes);
  const records: DnsRecords = {};
  let notFoundCount = 0;
  let hasAnyRecord = false;

  for (const recordType of recordTypes) {
    try {
      const rawValue = await withTimeout(
        resolvedDeps.resolveRecord(domain, recordType),
        resolvedDeps.timeoutMs,
        "DNS lookup timed out",
      );
      const normalized = normalizeRecordValue(recordType, rawValue);
      setRecordValue(records, recordType, normalized);
      hasAnyRecord ||= hasRecordData(normalized);
    } catch (error) {
      if (isNotFoundError(error)) {
        notFoundCount += 1;
        setRecordValue(records, recordType, emptyRecordValue(recordType));
        continue;
      }

      if (isNoDataError(error)) {
        setRecordValue(records, recordType, emptyRecordValue(recordType));
        continue;
      }

      if (isTimeoutError(error)) {
        throw new AppError(504, "DNS_TIMEOUT", "DNS lookup timed out");
      }

      throw new AppError(502, "INTERNAL_ERROR", `DNS lookup failed for ${recordType}`);
    }
  }

  if (notFoundCount > 0 && !hasAnyRecord) {
    throw new AppError(404, "DNS_NOT_FOUND", "Domain did not resolve");
  }

  let ssl: DnsSslSummary | null;

  try {
    ssl = await withTimeout(
      resolvedDeps.inspectCertificate(domain, resolvedDeps.timeoutMs),
      resolvedDeps.timeoutMs,
      "TLS inspection timed out",
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new AppError(504, "DNS_TIMEOUT", "TLS inspection timed out");
    }

    if (isTlsUnavailableError(error)) {
      ssl = null;
    } else {
      throw new AppError(502, "INTERNAL_ERROR", "TLS inspection failed");
    }
  }

  return {
    domain,
    records,
    ssl,
  };
}
