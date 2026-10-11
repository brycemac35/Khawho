import test from 'node:test';
import assert from 'node:assert';
import { validateName, randomName } from '../js/names.js';

test('validateName accepts valid name', () => {
  const result = validateName('Alice');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.name, 'Alice');
});

test('validateName rejects empty name', () => {
  const result = validateName('');
  assert.strictEqual(result.ok, false);
  assert(result.reason.length > 0);
});

test('validateName rejects null/undefined', () => {
  const result1 = validateName(null);
  assert.strictEqual(result1.ok, false);

  const result2 = validateName(undefined);
  assert.strictEqual(result2.ok, false);
});

test('validateName trims whitespace', () => {
  const result = validateName('  Alice  ');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.name, 'Alice');
});

test('validateName enforces max length (15 chars)', () => {
  const result = validateName('ThisIsAVeryLongName');
  assert.strictEqual(result.ok, false);
  assert(result.reason.includes('15'));

  const result2 = validateName('A'.repeat(15));
  assert.strictEqual(result2.ok, true);

  const result3 = validateName('A'.repeat(16));
  assert.strictEqual(result3.ok, false);
});

test('validateName checks uniqueness (case-insensitive)', () => {
  const existing = ['Alice', 'Bob'];
  const result = validateName('alice', existing);
  assert.strictEqual(result.ok, false);
  assert(result.reason.includes('taken'));

  const result2 = validateName('ALICE', existing);
  assert.strictEqual(result2.ok, false);
});

test('validateName detects profanity', () => {
  const badNames = [
    'stupid',
    'dumb',
    'damn',
    'hell',
    'hell',
  ];

  badNames.forEach((name) => {
    const result = validateName(name);
    assert.strictEqual(result.ok, false, `${name} should be rejected`);
    assert(result.reason.includes('inappropriate'));
  });
});

test('validateName detects leetspeak profanity', () => {
  const leetNames = [
    '5tupid', // Leetspeak for "stupid"
    'd4mn', // Leetspeak for "damn"
  ];

  leetNames.forEach((name) => {
    const result = validateName(name);
    assert.strictEqual(result.ok, false, `${name} (leetspeak) should be rejected`);
  });
});

test('validateName avoids false positives', () => {
  // These should pass (no profanity detected)
  const goodNames = [
    'Class',
    'Classroom',
    'Assistant',
    'Teacher',
    'Student',
    'Test',
    'Question',
  ];

  goodNames.forEach((name) => {
    const result = validateName(name);
    assert.strictEqual(result.ok, true, `${name} should be allowed`);
  });
});

test('randomName returns Adjective+Animal format', () => {
  const name = randomName();
  assert(typeof name === 'string');
  assert(name.length > 0);
  const parts = name.split(' ');
  assert.strictEqual(parts.length, 2, 'random name should be two words');
  // First word should be capitalized (adjective)
  assert(parts[0][0] === parts[0][0].toUpperCase());
  // Second word should be capitalized (animal)
  assert(parts[1][0] === parts[1][0].toUpperCase());
});

test('randomName generates variety', () => {
  const names = new Set();
  for (let i = 0; i < 100; i++) {
    names.add(randomName());
  }
  // Should have at least 50 unique names from 100 generations
  assert(names.size > 50, `should generate variety, got ${names.size} unique from 100`);
});
