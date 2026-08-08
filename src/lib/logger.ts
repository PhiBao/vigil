import { pino } from "pino";

/**
 * App logger. Structured, JSON in prod. Minimal, no dependency tricks.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "vigil" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
