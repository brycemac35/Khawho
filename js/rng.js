/**
 * True random number generation using crypto.getRandomValues
 * No Math.random anywhere.
 */

/**
 * Return a uniformly random integer in [0, n) using rejection sampling.
 * Uses Uint32 values from crypto.getRandomValues.
 * @param {number} n
 * @returns {number}
 */
export function randomInt(n) {
  if (n <= 0 || !Number.isInteger(n)) {
    throw new Error('randomInt: n must be a positive integer');
  }
  if (n === 1) return 0;

  // Max Uint32 value
  const MAX = 0xffffffff;
  // Largest multiple of n that fits in Uint32
  const limit = MAX - (MAX % n);

  const buffer = new Uint32Array(1);
  let value;
  do {
    globalThis.crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return value % n;
}

/**
 * Return a new array with the same elements in random order.
 * Uses Fisher-Yates shuffle with randomInt.
 * @param {Array} arr
 * @returns {Array}
 */
export function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate a random 6-digit PIN string where the first digit is non-zero.
 * @returns {string}
 */
export function randomPin() {
  const first = randomInt(9) + 1; // 1-9
  const rest = Array.from({ length: 5 }, () => randomInt(10));
  return String(first) + rest.join('');
}

/**
 * Generate a random hex string of the given byte length.
 * @param {number} bytes (default 8)
 * @returns {string}
 */
export function randomId(bytes = 8) {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}
