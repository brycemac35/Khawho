import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomInt, shuffle, randomPin, randomId } from '../js/rng.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const jsDir = join(__dirname, '../js');

test('randomInt range check', () => {
  for (let n = 1; n <= 10; n++) {
    for (let i = 0; i < 100; i++) {
      const val = randomInt(n);
      assert(val >= 0 && val < n, `randomInt(${n}) returned ${val}, expected [0, ${n})`);
    }
  }
});

test('randomInt rejects invalid inputs', () => {
  assert.throws(() => randomInt(0), /positive integer/);
  assert.throws(() => randomInt(-1), /positive integer/);
  assert.throws(() => randomInt(1.5), /positive integer/);
});

test('shuffle returns new array', () => {
  const original = [1, 2, 3, 4];
  const result = shuffle(original);
  assert.deepStrictEqual(original, [1, 2, 3, 4], 'original array was mutated');
  assert(result !== original, 'shuffle should return a new array');
});

test('shuffle is a permutation', () => {
  const original = [1, 2, 3, 4];
  const result = shuffle(original);
  const sorted = [...result].sort((a, b) => a - b);
  assert.deepStrictEqual(sorted, [1, 2, 3, 4], 'shuffle did not preserve elements');
});

test('randomPin format', () => {
  for (let i = 0; i < 100; i++) {
    const pin = randomPin();
    assert(typeof pin === 'string', 'randomPin should return a string');
    assert(pin.length === 6, `randomPin returned ${pin.length} digits, expected 6`);
    assert(/^\d+$/.test(pin), `randomPin returned non-digit characters: ${pin}`);
    assert(pin[0] !== '0', `randomPin first digit should be non-zero, got ${pin}`);
  }
});

test('randomId format', () => {
  for (let i = 0; i < 20; i++) {
    const id = randomId();
    assert(typeof id === 'string', 'randomId should return a string');
    assert(id.length === 16, `randomId(8) should be 16 hex chars, got ${id.length}`);
    assert(/^[0-9a-f]+$/.test(id), `randomId contains non-hex characters: ${id}`);
  }
});

test('randomId with custom byte length', () => {
  const id1 = randomId(4);
  assert(id1.length === 8, `randomId(4) should be 8 hex chars, got ${id1.length}`);

  const id32 = randomId(32);
  assert(id32.length === 64, `randomId(32) should be 64 hex chars, got ${id32.length}`);
});

test('chi-square uniformity for randomInt(4)', () => {
  const samples = 40000;
  const buckets = [0, 0, 0, 0];
  for (let i = 0; i < samples; i++) {
    buckets[randomInt(4)]++;
  }
  const expected = samples / 4;
  // Chi-square with 3 degrees of freedom, ~99.7% confidence
  // Generous threshold to avoid flakiness: allow up to 5% deviation
  const maxAllowed = expected * 1.05;
  const minAllowed = expected * 0.95;
  buckets.forEach((count, i) => {
    assert(count <= maxAllowed && count >= minAllowed,
      `Bucket ${i} had ${count} samples, expected ~${expected} (range ${minAllowed}-${maxAllowed})`);
  });
});

test('chi-square uniformity for shuffle positions (4 elements)', () => {
  // Track where element at index 0 ends up after shuffle
  const samples = 40000;
  const positionBuckets = [0, 0, 0, 0];
  for (let i = 0; i < samples; i++) {
    const result = shuffle([0, 1, 2, 3]);
    const posOfZero = result.indexOf(0);
    positionBuckets[posOfZero]++;
  }
  const expected = samples / 4;
  const maxAllowed = expected * 1.05;
  const minAllowed = expected * 0.95;
  positionBuckets.forEach((count, i) => {
    assert(count <= maxAllowed && count >= minAllowed,
      `Position ${i} had ${count} samples, expected ~${expected} (range ${minAllowed}-${maxAllowed})`);
  });
});

test('no Math.random in js/ directory', () => {
  let output;
  try {
    output = execSync(`grep -r "Math\\.random" "${jsDir}" 2>/dev/null || true`, { encoding: 'utf8' });
  } catch (e) {
    output = '';
  }
  const lines = output.trim().split('\n').filter(l => l.length > 0);
  assert(lines.length === 0, `Found Math.random in:\n${output}`);
});
