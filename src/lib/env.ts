import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal env-file loader (no dotenv dependency).
 * Loads `process.cwd()/.env.testnet` (and `.env.local`) into process.env,
 * without overriding already-set values.
 */
const FILES = [".env.testnet", ".env.local", ".env"];

export function loadEnv(): void {
  for (const file of FILES) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/** Read a key from env, throwing if missing. */
export function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

/** Read a persisted value from .env.testnet (used by scripts to share state). */
export function getPersisted(key: string): string | undefined {
  loadEnv();
  return process.env[key];
}

/** Persist a value into an env file (used to keep keys stable across runs). */
export function persistToEnv(key: string, value: string, file = ".env.testnet"): void {
  const path = resolve(process.cwd(), file);
  let text = "";
  if (existsSync(path)) text = readFileSync(path, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text += text.endsWith("\n") || text === "" ? `${key}=${value}\n` : `\n${key}=${value}\n`;
  }
  writeFileSync(path, text, { mode: 0o600 });
}
