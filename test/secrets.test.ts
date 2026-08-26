/**
 * Run token crypto — the autonomy credential's contract:
 * presentation is verified against only its SHA-256, timing-safely.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newRunToken, hashRunToken, verifyRunToken } from "../src/lib/secrets";

test("run tokens are 256-bit hex", () => {
  const t = newRunToken();
  assert.match(t, /^[0-9a-f]{64}$/);
});

test("verify accepts the right token via stored hash", () => {
  const t = newRunToken();
  const h = hashRunToken(t);
  assert.equal(verifyRunToken(t, h), true);
});

test("verify rejects wrong / missing / tampered tokens", () => {
  const t = newRunToken();
  const h = hashRunToken(t);
  assert.equal(verifyRunToken(newRunToken(), h), false);
  assert.equal(verifyRunToken(undefined, h), false);
  assert.equal(verifyRunToken(null, h), false);
  assert.equal(verifyRunToken("", h), false);
  assert.equal(verifyRunToken(`${t}0`, h), false); // even one extra char
});

test("stored material is the digest, never the token", () => {
  const t = newRunToken();
  assert.notEqual(hashRunToken(t), t);
  assert.ok(!hashRunToken(t).includes(t.slice(0, 8)));
});
