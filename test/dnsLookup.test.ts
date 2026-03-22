import { describe, expect, it } from "vitest";

import { lookupDomainIntelligence, type DnsLookupDeps } from "../src/lib/dnsLookup.js";

function createDeps(overrides: Partial<DnsLookupDeps> = {}): DnsLookupDeps {
  return {
    timeoutMs: 25,
    now: () => new Date("2026-01-10T00:00:00.000Z"),
    resolveRecord: async (_domain, recordType) => {
      switch (recordType) {
        case "A":
          return ["93.184.216.34"];
        case "MX":
          return [{ priority: 10, exchange: "mail.example.com" }];
        case "TXT":
          return [["v=spf1 ", "include:_spf.example.com ", "~all"]];
        case "SOA":
          return {
            nsname: "ns1.example.com",
            hostmaster: "hostmaster.example.com",
            serial: 2026032101,
            refresh: 3600,
            retry: 600,
            expire: 1209600,
            minttl: 300,
          };
        default:
          return [];
      }
    },
    inspectCertificate: async () => ({
      issuer: "Example CA",
      validFrom: "2026-01-01",
      validTo: "2026-02-10",
      daysRemaining: 31,
    }),
    ...overrides,
  };
}

describe("lookupDomainIntelligence", () => {
  it("normalizes requested records and certificate metadata", async () => {
    const result = await lookupDomainIntelligence("Example.COM.", ["A", "MX", "TXT", "SOA"], createDeps());

    expect(result).toEqual({
      domain: "example.com",
      records: {
        A: ["93.184.216.34"],
        MX: [{ priority: 10, exchange: "mail.example.com" }],
        TXT: ["v=spf1 include:_spf.example.com ~all"],
        SOA: {
          nsname: "ns1.example.com",
          hostmaster: "hostmaster.example.com",
          serial: 2026032101,
          refresh: 3600,
          retry: 600,
          expire: 1209600,
          minttl: 300,
        },
      },
      ssl: {
        issuer: "Example CA",
        validFrom: "2026-01-01",
        validTo: "2026-02-10",
        daysRemaining: 31,
      },
    });
  });

  it("rejects malformed domains", async () => {
    await expect(lookupDomainIntelligence("bad domain", ["A"], createDeps())).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_DOMAIN",
    });
  });

  it("maps NXDOMAIN into a DNS_NOT_FOUND error", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOTFOUND" });

    await expect(
      lookupDomainIntelligence(
        "missing.example",
        ["A"],
        createDeps({
          resolveRecord: async () => {
            throw missingError;
          },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "DNS_NOT_FOUND",
    });
  });

  it("maps slow lookups into a DNS_TIMEOUT error", async () => {
    await expect(
      lookupDomainIntelligence(
        "example.com",
        ["A"],
        createDeps({
          timeoutMs: 5,
          resolveRecord: async () => new Promise(() => undefined),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "DNS_TIMEOUT",
    });
  });

  it("returns ssl null when the host does not accept TLS on port 443", async () => {
    const result = await lookupDomainIntelligence(
      "localhost",
      ["A"],
      createDeps({
        resolveRecord: async () => ["127.0.0.1"],
        inspectCertificate: async () => null,
      }),
    );

    expect(result.ssl).toBeNull();
    expect(result.records.A).toEqual(["127.0.0.1"]);
  });
});
