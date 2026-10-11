/**
 * Encryption/decryption for quizzes with password protection.
 * Uses AES-GCM with PBKDF2-derived keys.
 */

import { quizToJSON, quizFromJSON } from './quiz.js';

const PBKDF2_ITERATIONS = 310000;
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes
const KEY_LENGTH = 32; // bytes (256 bits)
const TAG_LENGTH = 16; // bytes (128 bits)

/**
 * Derive a key from a password using PBKDF2-SHA256.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
    },
    passwordKey,
    KEY_LENGTH * 8, // bits
  );

  return globalThis.crypto.subtle.importKey('raw', derivedBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a quiz with a password.
 * @param {Object} quiz
 * @param {string} password
 * @returns {Promise<Object>} encrypted file object
 */
export async function encryptQuiz(quiz, password) {
  const plaintext = quizToJSON(quiz);
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // Generate random salt and IV
  const salt = new Uint8Array(SALT_LENGTH);
  const iv = new Uint8Array(IV_LENGTH);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  // Derive key from password
  const key = await deriveKey(password, salt);

  // Encrypt
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: TAG_LENGTH * 8, // bits
    },
    key,
    plaintextBytes,
  );

  // Convert to base64
  const saltB64 = Buffer.from(salt).toString('base64');
  const ivB64 = Buffer.from(iv).toString('base64');
  const ciphertextB64 = Buffer.from(ciphertext).toString('base64');

  return {
    format: 'khawho-quiz-enc',
    v: 1,
    title: quiz.title,
    author: quiz.author,
    count: quiz.questions.length,
    updated: quiz.updated,
    salt: saltB64,
    iv: ivB64,
    data: ciphertextB64,
  };
}

/**
 * Decrypt an encrypted quiz file.
 * @param {Object} file - encrypted file object from encryptQuiz
 * @param {string} password
 * @returns {Promise<Object>} quiz object
 * @throws {Error} 'Wrong teacher password' on auth failure
 */
export async function decryptQuiz(file, password) {
  let ciphertext;
  let salt;
  let iv;

  try {
    // Decode base64
    salt = new Uint8Array(Buffer.from(file.salt, 'base64'));
    iv = new Uint8Array(Buffer.from(file.iv, 'base64'));
    ciphertext = new Uint8Array(Buffer.from(file.data, 'base64'));
  } catch (err) {
    throw new Error('Wrong teacher password');
  }

  // Derive key from password
  const key = await deriveKey(password, salt);

  // Decrypt
  let plaintext;
  try {
    const plaintextBytes = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: TAG_LENGTH * 8, // bits
      },
      key,
      ciphertext,
    );
    plaintext = new TextDecoder().decode(plaintextBytes);
  } catch (err) {
    // Decryption failure (wrong password or tampered data)
    throw new Error('Wrong teacher password');
  }

  // Parse JSON
  try {
    return quizFromJSON(plaintext);
  } catch (err) {
    throw new Error('Wrong teacher password');
  }
}
