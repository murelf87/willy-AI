// OpenCode Zen en WILLY: solo sus modelos gratuitos, con las mismas reglas que el resto de motores.
// Las pruebas de extremo a extremo usan una API falsa (sin internet) para comprobar QUÉ pide WILLY y QUÉ modelo elige.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  callEngine, canTryAnotherModel, classifyFailure, defaultState, pickModel, rankModels, saveState, PROVIDERS,
} from "../src/lib/engines-server.ts";
import { BUILD_ORDER, CHAT_ORDER, KIND_CLOUD_ORDER } from "../src/lib/routing-table.ts";

const provider = (id) => {
  const found = PROVIDERS.find((item) => item.id === id);
  assert.ok(found, `falta el proveedor ${id}`);
  return found;
};

// Catálogo mezclado, como el que devuelve Zen: modelos de pago y gratuitos juntos.
const CATALOG = ["claude-opus-5", "gpt-6-sol", "kimi-k3", "glm-5.3", "big-pickle", "qwen3.6-plus-free", "deepseek-v4-flash-free", "mimo-v2.5-free"];
const FREE = ["big-pickle", "deepseek-v4-flash-free", "mimo-v2.5-free", "qwen3.6-plus-free"];

test("OpenCode Zen está registrado con su API oficial y su página de claves", () => {
  const zen = provider("opencode");
  assert.equal(zen.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(zen.keyUrl, "https://opencode.ai/auth");
  assert.match(zen.dataNote, /gratuitos/);
});

test("solo quedan los modelos gratuitos; los de pago se descartan", () => {
  assert.deepEqual([...rankModels(provider("opencode"), CATALOG)].sort(), [...FREE].sort());
});

test("prefiere Big Pickle y, sin él, Qwen Plus", () => {
  assert.equal(pickModel(provider("opencode"), CATALOG), "big-pickle");
  assert.equal(pickModel(provider("opencode"), ["mimo-v2.5-free", "nemotron-3-ultra-free", "qwen3.6-plus-free"]), "qwen3.6-plus-free");
});

test("si solo hay modelos de pago, no elige ninguno", () => {
  assert.equal(pickModel(provider("opencode"), ["claude-opus-5", "gpt-6-sol", "kimi-k3", "glm-5.3"]), null);
});

test("nombres parecidos que no son gratuitos no cuelan", () => {
  assert.equal(pickModel(provider("opencode"), ["big-pickle-pro", "free-model", "freebie", "qwen3.6-plus-free-trial"]), null);
});

test("el filtro de OpenRouter no cambia (solo «:free»)", () => {
  const openrouter = provider("openrouter");
  assert.equal(pickModel(openrouter, ["vendor/model", "vendor/model:free"]), "vendor/model:free");
  assert.equal(pickModel(openrouter, ["big-pickle", "qwen3.6-plus-free"]), null);
});

test("enrutado: va justo detrás de OpenRouter, y no en Jurídico ni en Visión", () => {
  for (const [name, order] of [["chat", CHAT_ORDER], ["autoconstrucción", BUILD_ORDER], ["código", KIND_CLOUD_ORDER.codigo], ["general", KIND_CLOUD_ORDER.general]]) {
    assert.equal(order.indexOf("opencode"), order.indexOf("openrouter") + 1, `orden de ${name}`);
  }
  assert.ok(!KIND_CLOUD_ORDER.juridico.includes("opencode"));
  assert.ok(!KIND_CLOUD_ORDER.vision.includes("opencode"));
});

test("un gratuito saturado (429) hace probar otro modelo; una clave rechazada no", () => {
  assert.equal(canTryAnotherModel("opencode", 429, '{"error":{"message":"Rate limit exceeded"}}'), true);
  assert.equal(canTryAnotherModel("opencode", 401, '{"error":"invalid api key"}'), false);
});

test("si OpenCode pide pago, WILLY lo aparta 24 horas", () => {
  const failure = classifyFailure(402, '{"error":{"message":"Payment required: add billing details"}}', null, 0);
  assert.equal(failure.kind, "payment");
  assert.equal(failure.cooldownMs, 24 * 60 * 60 * 1000);
});

/** Carpeta de estado temporal con el motor OpenCode activado y una clave de prueba. */
async function withEngine(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "willy-opencode-"));
  try {
    const state = defaultState();
    state.master = true;
    state.engines.opencode = { key: "zen-test-key-1234", enabled: true, cooldownUntil: 0, reason: "", day: "", used: 0, lastOk: 0 };
    await saveState(dir, state);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** API falsa de Zen: apunta cada petición y contesta como la real. `chat` decide la respuesta de cada /chat/completions. */
function fakeZen(chat) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization"), body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (call.url.endsWith("/models")) return new Response(JSON.stringify({ object: "list", data: CATALOG.map((id) => ({ id, object: "model" })) }), { status: 200 });
    if (call.url.endsWith("/chat/completions")) return chat(call);
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

const answer = (text) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }), { status: 200 });

test("de extremo a extremo: lista los modelos con tu clave, elige uno gratuito y lo usa", async () => {
  await withEngine(async (dir) => {
    const zen = fakeZen(() => answer("hola desde Zen"));
    const result = await callEngine({ dir, fetchImpl: zen.fetchImpl }, "opencode", [{ role: "user", content: "di hola" }]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data, "hola desde Zen");
    assert.equal(result.model, "big-pickle");
    assert.equal(zen.calls[0].url, "https://opencode.ai/zen/v1/models");
    assert.equal(zen.calls[0].auth, "Bearer zen-test-key-1234");
    const chats = zen.calls.filter((c) => c.url.endsWith("/chat/completions"));
    assert.equal(chats.length, 1);
    assert.equal(chats[0].url, "https://opencode.ai/zen/v1/chat/completions");
    assert.equal(chats[0].method, "POST");
    assert.equal(chats[0].auth, "Bearer zen-test-key-1234");
    assert.equal(chats[0].body.model, "big-pickle");
  });
});

test("de extremo a extremo: si Big Pickle está saturado, usa otro gratuito y nunca uno de pago", async () => {
  await withEngine(async (dir) => {
    const zen = fakeZen((call) => call.body.model === "big-pickle"
      ? new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })
      : answer(`contesta ${call.body.model}`));
    const result = await callEngine({ dir, fetchImpl: zen.fetchImpl }, "opencode", [{ role: "user", content: "di hola" }]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(FREE.includes(result.model) && result.model !== "big-pickle", result.model);
    const used = zen.calls.filter((c) => c.url.endsWith("/chat/completions")).map((c) => c.body.model);
    assert.ok(used.every((model) => FREE.includes(model)), `modelos usados: ${used.join(", ")}`);
  });
});
