import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
// Run with Node 24+: node --test tests/engine-plan.test.mjs
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return next(specifier, context);
}});
const { attemptStep, shouldRelay, buildSequence } = await import('../src/lib/engine-plan.ts');
const steps = ['first', 'second', 'third'].map(id => ({ kind: 'cloud', id, key: 'cloud:' + id, label: id }));
test('compilation and format repairs stay on the same provider', () => {
  for (let i = 0; i < 12; i++) assert.equal(attemptStep(steps, new Set()).id, 'first');
});
test('exhausted providers are skipped in order and never revisited', () => {
  const skipped = new Set(['cloud:first']);
  for (let i = 0; i < 12; i++) assert.equal(attemptStep(steps, skipped).id, 'second');
  skipped.add('cloud:second');
  assert.equal(attemptStep(steps, skipped).id, 'third');
  skipped.add('cloud:third');
  assert.equal(attemptStep(steps, skipped), null);
  assert.equal(attemptStep([], new Set()), null);
});
test('only confirmed exhaustion or incompatibility permits a relay', () => {
  for (const kind of ['quota-day', 'auth', 'payment', 'model', 'too-large']) assert.equal(shouldRelay(kind), true, kind);
  for (const kind of ['quota-minute', 'transient', 'empty', 'other', 'unavailable', undefined]) assert.equal(shouldRelay(kind), false, kind);
});
test('local-only work also keeps its first model', () => {
  const local = buildSequence(null, ['coder', 'backup']);
  for (let i = 0; i < 12; i++) assert.equal(attemptStep(local, new Set()).key, 'local:coder');
  assert.equal(attemptStep(local, new Set(['local:coder'])).key, 'local:backup');
});
