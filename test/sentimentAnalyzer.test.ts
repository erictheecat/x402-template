import { describe, expect, it } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { analyzeSentiment } from "../src/lib/sentiment.js";

describe("analyzeSentiment", () => {
  it("classifies strongly positive English text", () => {
    const result = analyzeSentiment("This product is absolutely fantastic and exceeded all my expectations.");

    expect(result.sentiment).toBe("positive");
    expect(result.score).toBeGreaterThan(0.25);
    expect(result.magnitude).toBeGreaterThan(0.25);
    expect(result.language).toBe("en");
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]).toMatchObject({
      sentiment: "positive",
    });
  });

  it("classifies negative text with negation", () => {
    const result = analyzeSentiment("The onboarding is not good and the dashboard feels broken.");

    expect(result.sentiment).toBe("negative");
    expect(result.score).toBeLessThan(-0.2);
    expect(result.sentences[0]).toMatchObject({
      sentiment: "negative",
    });
  });

  it("returns neutral for informational text", () => {
    const result = analyzeSentiment("The package arrived on Tuesday and includes a charger.");

    expect(result.sentiment).toBe("neutral");
    expect(Math.abs(result.score)).toBeLessThan(0.2);
  });

  it("returns best-effort output for non-English text", () => {
    const result = analyzeSentiment("これは本当にひどい体験でした。");

    expect(result.language).toBe("ja");
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]?.text).toContain("これは本当にひどい体験でした");
  });

  it("rejects empty input", () => {
    expect.assertions(3);

    try {
      analyzeSentiment("   ");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: "INVALID_TEXT",
      });
      expect((error as AppError).message).toContain("Text");
    }
  });

  it("rejects text larger than 10KB", () => {
    expect.assertions(2);

    try {
      analyzeSentiment("a".repeat(10_241));
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 413,
        code: "TEXT_TOO_LONG",
      });
      expect(error).toBeInstanceOf(AppError);
    }
  });
});
