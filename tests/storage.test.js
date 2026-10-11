import test from 'node:test';
import assert from 'node:assert';
import {
  listLocalQuizzes,
  saveLocalQuiz,
  deleteLocalQuiz,
  getLocalQuiz,
  getTeacherPassword,
  setTeacherPassword,
  forgetTeacherPassword,
  getGithubToken,
  setGithubToken,
  forgetGithubToken,
  slugify,
} from '../js/storage.js';
import { newQuiz, newQuestion } from '../js/quiz.js';

// Mock localStorage for Node tests
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    data: {},
    getItem(key) {
      return this.data[key] || null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
    removeItem(key) {
      delete this.data[key];
    },
    clear() {
      this.data = {};
    },
  };
}

// Helper to clear storage between tests
function clearStorage() {
  globalThis.localStorage.clear();
}

test('slugify converts to lowercase', () => {
  assert(slugify('My Quiz').includes('my') && slugify('My Quiz').includes('quiz'));
});

test('slugify replaces spaces and special chars', () => {
  const slug = slugify('My Quiz #1');
  assert(!slug.includes(' '));
  assert(!slug.includes('#'));
  assert(slug.includes('-'));
});

test('listLocalQuizzes returns empty array initially', () => {
  clearStorage();
  const quizzes = listLocalQuizzes();
  assert(Array.isArray(quizzes));
  assert(quizzes.length === 0);
});

test('saveLocalQuiz stores quiz in localStorage', () => {
  clearStorage();
  const quiz = newQuiz();
  quiz.title = 'Test Quiz';
  saveLocalQuiz(quiz);

  const stored = listLocalQuizzes();
  assert(stored.length === 1);
  assert(stored[0].title === 'Test Quiz');
  assert(stored[0].id === quiz.id);
});

test('getLocalQuiz retrieves a quiz by id', () => {
  clearStorage();
  const quiz = newQuiz();
  quiz.title = 'Test Quiz';
  saveLocalQuiz(quiz);

  const retrieved = getLocalQuiz(quiz.id);
  assert(retrieved.title === 'Test Quiz');
  assert(retrieved.id === quiz.id);
});

test('getLocalQuiz returns null for missing quiz', () => {
  clearStorage();
  const retrieved = getLocalQuiz('nonexistent');
  assert(retrieved === null);
});

test('deleteLocalQuiz removes a quiz', () => {
  clearStorage();
  const quiz = newQuiz();
  quiz.title = 'Test Quiz';
  saveLocalQuiz(quiz);

  assert(listLocalQuizzes().length === 1);
  deleteLocalQuiz(quiz.id);
  assert(listLocalQuizzes().length === 0);
});

test('saveLocalQuiz updates existing quiz', () => {
  clearStorage();
  const quiz = newQuiz();
  quiz.title = 'Original';
  saveLocalQuiz(quiz);

  quiz.title = 'Updated';
  saveLocalQuiz(quiz);

  const stored = listLocalQuizzes();
  assert(stored.length === 1);
  assert(stored[0].title === 'Updated');
});

test('setTeacherPassword stores password', () => {
  clearStorage();
  setTeacherPassword('mysecret');
  const pwd = getTeacherPassword();
  assert(pwd === 'mysecret');
});

test('getTeacherPassword returns null when not set', () => {
  clearStorage();
  const pwd = getTeacherPassword();
  assert(pwd === null);
});

test('forgetTeacherPassword clears password', () => {
  clearStorage();
  setTeacherPassword('mysecret');
  assert(getTeacherPassword() === 'mysecret');
  forgetTeacherPassword();
  assert(getTeacherPassword() === null);
});

test('setGithubToken stores token', () => {
  clearStorage();
  setGithubToken('github_token_xyz');
  const token = getGithubToken();
  assert(token === 'github_token_xyz');
});

test('getGithubToken returns null when not set', () => {
  clearStorage();
  const token = getGithubToken();
  assert(token === null);
});

test('forgetGithubToken clears token', () => {
  clearStorage();
  setGithubToken('github_token_xyz');
  assert(getGithubToken() === 'github_token_xyz');
  forgetGithubToken();
  assert(getGithubToken() === null);
});

test('saveLocalQuiz persists multiple quizzes', () => {
  clearStorage();
  for (let i = 0; i < 3; i++) {
    const quiz = newQuiz();
    quiz.title = `Quiz ${i}`;
    saveLocalQuiz(quiz);
  }

  const all = listLocalQuizzes();
  assert(all.length === 3);
  assert(all.every(q => q.title.startsWith('Quiz')));
});
