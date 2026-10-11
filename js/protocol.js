/**
 * Protocol message types and builder functions
 * All messages are JSON-serializable objects with a 't' (type) field.
 */

// Player to Host messages
export const MSG_JOIN = 'join';
export const MSG_ANSWER = 'answer';

// Host to Player messages
export const MSG_WELCOME = 'welcome';
export const MSG_REJECT = 'reject';
export const MSG_LOBBY = 'lobby';
export const MSG_KICKED = 'kicked';
export const MSG_PAUSED = 'paused';
export const MSG_QUESTION = 'question';
export const MSG_ANSWERED = 'answered';
export const MSG_REVEAL = 'reveal';
export const MSG_END = 'end';

// Message builders

export function join(name, clientId) {
  return { t: MSG_JOIN, name, clientId };
}

export function answer(qIndex, answer) {
  return { t: MSG_ANSWER, qIndex, answer };
}

export function welcome(name, score) {
  return { t: MSG_WELCOME, name, score };
}

export function reject(reason) {
  return { t: MSG_REJECT, reason };
}

export function lobby() {
  return { t: MSG_LOBBY };
}

export function kicked() {
  return { t: MSG_KICKED };
}

export function paused(paused) {
  return { t: MSG_PAUSED, paused };
}

export function question(qIndex, total, type, text, image, timeLimit, multi, answers) {
  return { t: MSG_QUESTION, qIndex, total, type, text, image, timeLimit, multi, answers };
}

export function answered() {
  return { t: MSG_ANSWERED };
}

export function reveal(correct, points, score, streak, rank, correctIds, correctText) {
  return { t: MSG_REVEAL, correct, points, score, streak, rank, correctIds, correctText };
}

export function end(rank, score, total) {
  return { t: MSG_END, rank, score, total };
}
