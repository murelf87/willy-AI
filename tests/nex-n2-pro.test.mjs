import assert from "node:assert/strict";
import test from "node:test";
import { pickModel, PROVIDERS } from "../src/lib/engines-server.ts";

test("Nex-N2-Pro free takes priority over other OpenRouter free models", () => {
  const provider = PROVIDERS.find((item) => item.id === "openrouter");
  assert.ok(provider);
  assert.equal(pickModel(provider, [
    "other/some-coder:free",
    "nex-agi/nex-n2-pro:free",
    "nex-agi/nex-n2-pro",
  ]), "nex-agi/nex-n2-pro:free");
});

test("Nex-N2-Pro paid is excluded, even when listed alone", () => {
  const provider = PROVIDERS.find((item) => item.id === "openrouter");
  assert.ok(provider);
  assert.equal(pickModel(provider, ["nex-agi/nex-n2-pro"]), null);
});
