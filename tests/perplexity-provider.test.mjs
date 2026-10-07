import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return next(specifier, context);
}});

const { PROVIDERS, rankModels, openAIResponseText } = await import('../src/lib/engines-server.ts');
const { KIND_CLOUD_ORDER } = await import('../src/lib/routing-table.ts');

test('Perplexity is configured as Agent API and restricted to Sonar', () => {
  const provider = PROVIDERS.find((p) => p.id === 'perplexity');
  assert.ok(provider);
  assert.equal(provider.baseUrl, 'https://api.perplexity.ai/v1');
  assert.deepEqual(provider.fallbackModels, ['perplexity/sonar']);
  assert.equal(provider.allowListedOnly, true);
  assert.deepEqual(rankModels(provider, ['perplexity/sonar', 'openai/gpt-5.4']), ['perplexity/sonar']);
});

test('Jurídico prioritizes Perplexity when configured', () => {
  assert.equal(KIND_CLOUD_ORDER.juridico[0], 'perplexity');
  assert.equal(KIND_CLOUD_ORDER.investigacion[0], 'perplexity');
});

test('Responses-style text parser accepts Agent API message content', () => {
  const raw = JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'RESPUESTA JURIDICA' }] }] });
  assert.equal(openAIResponseText(raw), 'RESPUESTA JURIDICA');
});
