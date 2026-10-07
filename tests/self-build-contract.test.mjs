import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return next(new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href, context);
  return next(specifier, context);
}});

const { composeOwnerContract, mergeOwnerInstructions, numberedOwnerRules } = await import('../src/lib/self-build-contract.ts');

const rules = Array.from({ length: 121 }, (_, i) => `${i + 1}. Regla obligatoria número ${i + 1}`).join('\n');

test('121 numbered permanent rules satisfy the contract without 121 chat lessons', () => {
  const contract = composeOwnerContract('', rules, []);
  assert.equal(contract.complete, true);
  assert.ok(contract.count >= 121);
  assert.equal(contract.warning, '');
  assert.match(contract.rules, /Regla obligatoria número 121/);
});

test('server and browser instructions are both preserved when they differ', () => {
  const merged = mergeOwnerInstructions('Regla servidor: conservar backups.', 'Regla navegador: mantener responsive.');
  assert.match(merged, /conservar backups/);
  assert.match(merged, /mantener responsive/);
});

test('learned lessons complement numbered permanent rules without blocking execution', () => {
  const partial = Array.from({ length: 119 }, (_, i) => `${i + 1}. Regla ${i + 1}`).join('\n');
  const lessons = [
    { id: 'a', text: 'Regla adicional A', at: '', source: 'test' },
    { id: 'b', text: 'Regla adicional B', at: '', source: 'test' },
  ];
  const contract = composeOwnerContract('', partial, lessons);
  assert.equal(contract.complete, true);
  assert.ok(contract.count >= 121);
});

test('incomplete detectable count warns but never drops available instructions', () => {
  const contract = composeOwnerContract('', '1. Mantener lo que funciona.\n2. Hacer copia.', []);
  assert.equal(contract.complete, false);
  assert.match(contract.warning, /no bloquea el trabajo/i);
  assert.match(contract.rules, /Mantener lo que funciona/);
});

test('numbered rule detector recognizes normal list and Regla N form', () => {
  assert.deepEqual(numberedOwnerRules('1. Uno\n2) Dos\nRegla 3: Tres', 10), [1,2,3]);
});
