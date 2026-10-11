/**
 * Player name validation and random nickname generation
 * Profanity filter on normalized leetspeak
 */

import { randomInt } from './rng.js';

// Adjectives for random names
const adjectives = [
  'Happy', 'Silly', 'Clever', 'Quick', 'Brave', 'Sleepy', 'Crazy', 'Funky',
  'Shiny', 'Speedy', 'Calm', 'Bold', 'Keen', 'Witty', 'Sharp', 'Gentle',
  'Jolly', 'Merry', 'Bubbly', 'Spicy', 'Cool', 'Warm', 'Bright', 'Swift',
  'Lucky', 'Cosmic', 'Mighty', 'Lazy', 'Bouncy', 'Crafty', 'Nimble', 'Perky',
  'Quirky', 'Zippy', 'Zesty', 'Vivid', 'Posh', 'Slick', 'Zany', 'Yappy',
  'Feisty', 'Fierce', 'Grand', 'Groovy', 'Humble', 'Joking', 'Kooky', 'Lively',
  'Melodic', 'Noble', 'Optimal', 'Perfect', 'Radical', 'Serene', 'Stellar', 'Tangy',
];

// Animals for random names
const animals = [
  'Panda', 'Tiger', 'Eagle', 'Fox', 'Otter', 'Llama', 'Penguin', 'Dolphin',
  'Giraffe', 'Koala', 'Badger', 'Whale', 'Owl', 'Hawk', 'Swan', 'Sloth',
  'Racoon', 'Cougar', 'Lynx', 'Moose', 'Zebra', 'Seal', 'Mole', 'Cheetah',
  'Antelope', 'Bison', 'Caribou', 'Deer', 'Elk', 'Fox', 'Goat', 'Hedgehog',
  'Impala', 'Jackal', 'Kangaroo', 'Lemur', 'Meerkat', 'Narwhal', 'Orangutan', 'Puma',
  'Quail', 'Reindeer', 'Squirrel', 'Turkey', 'Urchin', 'Viper', 'Walrus', 'Yak',
  'Zebra', 'Antelope', 'Badger', 'Cheetah', 'Dragon', 'Eagle', 'Falcon', 'Giraffe',
];

// Profanity filter: whole-word normalized tokens (common school-inappropriate words)
// Be conservative to avoid false positives on words like "class", "ass" (as in Assam)
const profanityTokens = [
  'bad', 'crap', 'damn', 'damn', 'frick', 'freaking', 'hell', 'piss',
  'sucks', 'crap', 'kill', 'die', 'hate', 'stupid', 'dumb', 'idiot',
  'jerk', 'loser', 'wimp', 'nerd', 'geek', 'ugly', 'fat', 'skinny',
];

// Substrings that are never innocent (partial matching ok)
const profanitySubstrings = [
  'asshole', 'bitch', 'damn', 'fart', 'poo', 'piss',
];

/**
 * Normalize leetspeak for profanity checking
 * 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, strip non-letters
 */
function normalizeLeetspeak(text) {
  const map = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '@': 'a',
    '$': 's',
  };
  let normalized = text.toLowerCase();
  Object.entries(map).forEach(([k, v]) => {
    normalized = normalized.replace(new RegExp(k, 'g'), v);
  });
  // Remove non-letters (keep spaces for word separation)
  normalized = normalized.replace(/[^a-z\s]/g, '');
  return normalized;
}

/**
 * Check if a name contains profanity
 */
function hasProfanity(name) {
  const normalized = normalizeLeetspeak(name);

  // Check whole-word tokens
  const tokens = normalized.split(/\s+/);
  for (const token of tokens) {
    if (profanityTokens.includes(token)) {
      return true;
    }
  }

  // Check substrings (also check if word contains profanity)
  for (const substring of profanitySubstrings) {
    if (normalized.includes(substring)) {
      return true;
    }
  }

  // Also check if any token contains a profanity token as substring
  for (const token of tokens) {
    for (const profWord of profanityTokens) {
      if (token.includes(profWord) && profWord.length >= 4) {
        // Only flag if profanity word is substantial (avoid false positives on short words)
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate a player name
 * @param {string} name - The proposed name
 * @param {string[]} existingNames - Already-used names (case-insensitive comparison)
 * @returns {object} {ok: bool, name: string, reason: string}
 */
export function validateName(name, existingNames = []) {
  if (!name || typeof name !== 'string') {
    return { ok: false, name: '', reason: 'Name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { ok: false, name: '', reason: 'Name cannot be empty' };
  }

  if (trimmed.length > 15) {
    return { ok: false, name: trimmed.substring(0, 15), reason: 'Name must be 15 characters or less' };
  }

  if (hasProfanity(trimmed)) {
    return { ok: false, name: trimmed, reason: 'Name contains inappropriate content' };
  }

  // Check uniqueness (case-insensitive)
  const lowerTrimmed = trimmed.toLowerCase();
  for (const existing of existingNames) {
    if (existing.toLowerCase() === lowerTrimmed) {
      return { ok: false, name: trimmed, reason: 'That name is already taken' };
    }
  }

  return { ok: true, name: trimmed, reason: '' };
}

/**
 * Generate a random nickname (Adjective + Animal)
 * @returns {string}
 */
export function randomName() {
  const adj = adjectives[randomInt(adjectives.length)];
  const animal = animals[randomInt(animals.length)];
  return `${adj} ${animal}`;
}
