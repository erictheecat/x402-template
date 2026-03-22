import { AppError } from "./errors.js";

export const MAX_SENTIMENT_TEXT_BYTES = 10 * 1024;
export const SENTIMENT_ROUTE_PRICE_USDC = "0.002";
export const SENTIMENT_ROUTE_PRICE_BASE_UNITS = "2000";

const NEGATORS = new Set(["not", "never", "no", "hardly", "barely", "without", "isn't", "wasn't", "don't", "didn't"]);
const INTENSIFIERS = new Map<string, number>([
  ["absolutely", 1.35],
  ["really", 1.2],
  ["very", 1.15],
  ["deeply", 1.25],
  ["extremely", 1.4],
  ["super", 1.25],
]);

const SENTIMENT_LEXICON = new Map<string, number>([
  ["amazing", 3],
  ["awesome", 3],
  ["bad", -1.75],
  ["bueno", 1.5],
  ["beautiful", 2],
  ["boring", -1.5],
  ["broken", -2.5],
  ["clean", 1.25],
  ["confusing", -1.75],
  ["delightful", 2.5],
  ["disappointing", -2.5],
  ["excellent", 3],
  ["excelente", 3],
  ["exceeded", 2],
  ["fantastic", 3],
  ["fast", 1.25],
  ["good", 1.5],
  ["great", 2.25],
  ["horrible", -3],
  ["love", 3],
  ["negative", -1.25],
  ["outstanding", 3],
  ["positive", 1.25],
  ["poor", -2],
  ["promising", 1.5],
  ["terrible", -3],
  ["useful", 1.5],
  ["weak", -1.5],
  ["malo", -1.75],
]);

const ENGLISH_STOPWORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "are",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
]);

const SPANISH_STOPWORDS = new Set(["de", "el", "es", "la", "las", "los", "muy", "que", "un", "una", "y"]);

export type SentimentLabel = "positive" | "neutral" | "negative";

export interface SentenceSentiment {
  text: string;
  sentiment: SentimentLabel;
  score: number;
}

export interface SentimentAnalysis {
  sentiment: SentimentLabel;
  score: number;
  magnitude: number;
  language: string;
  sentences: SentenceSentiment[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function roundTo(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function classifySentiment(score: number): SentimentLabel {
  if (score > 0.15) return "positive";
  if (score < -0.15) return "negative";
  return "neutral";
}

function validateText(input: string): string {
  const text = normalizeWhitespace(input);

  if (!text) {
    throw new AppError(400, "INVALID_TEXT", "Text must not be empty");
  }

  if (Buffer.byteLength(text, "utf8") > MAX_SENTIMENT_TEXT_BYTES) {
    throw new AppError(413, "TEXT_TOO_LONG", "Text must be 10KB or less");
  }

  return text;
}

function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?。！？]+[.!?。！？]*/gu) ?? [];
  const sentences = matches.map((sentence) => normalizeWhitespace(sentence)).filter(Boolean);
  return sentences.length > 0 ? sentences : [text];
}

function tokenize(sentence: string): string[] {
  return sentence.toLowerCase().match(/\p{L}[\p{L}\p{M}'-]*/gu) ?? [];
}

function detectLanguage(text: string, tokens: string[]): string {
  if (/[\u3040-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh";

  const englishHits = tokens.filter((token) => ENGLISH_STOPWORDS.has(token)).length;
  const spanishHits = tokens.filter((token) => SPANISH_STOPWORDS.has(token)).length;

  if (spanishHits > englishHits) {
    return "es";
  }

  if (englishHits > 0 || /^[\t\n\r -~]+$/u.test(text)) {
    return "en";
  }

  return "unknown";
}

function scoreSentence(tokens: string[]): number {
  let total = 0;
  let negateWindow = 0;
  let intensity = 1;

  for (const token of tokens) {
    if (NEGATORS.has(token)) {
      negateWindow = 3;
      continue;
    }

    const nextIntensity = INTENSIFIERS.get(token);
    if (nextIntensity) {
      intensity *= nextIntensity;
      continue;
    }

    const lexiconScore = SENTIMENT_LEXICON.get(token);
    if (typeof lexiconScore === "number") {
      const weighted = lexiconScore * intensity * (negateWindow > 0 ? -1 : 1);
      total += weighted;
    }

    intensity = 1;
    negateWindow = Math.max(0, negateWindow - 1);
  }

  return total;
}

function normalizeScore(rawScore: number): number {
  return roundTo(Math.tanh(rawScore / 3));
}

export function analyzeSentiment(input: string): SentimentAnalysis {
  const text = validateText(input);
  const sentences = splitIntoSentences(text);

  const sentenceResults = sentences.map((sentence) => {
    const tokens = tokenize(sentence);
    const rawScore = scoreSentence(tokens);
    const score = normalizeScore(rawScore);

    return {
      text: sentence,
      sentiment: classifySentiment(score),
      score,
      rawScore,
      tokens,
    };
  });

  const allTokens = sentenceResults.flatMap((result) => result.tokens);
  const overallRawScore = sentenceResults.reduce((sum, result) => sum + result.rawScore, 0);
  const overallScore = normalizeScore(overallRawScore);
  const magnitude =
    sentenceResults.length === 0
      ? 0
      : roundTo(
          sentenceResults.reduce((sum, result) => sum + Math.abs(result.score), 0) / sentenceResults.length,
        );

  return {
    sentiment: classifySentiment(overallScore),
    score: overallScore,
    magnitude,
    language: detectLanguage(text, allTokens),
    sentences: sentenceResults.map(({ text: sentenceText, sentiment, score }) => ({
      text: sentenceText,
      sentiment,
      score,
    })),
  };
}
