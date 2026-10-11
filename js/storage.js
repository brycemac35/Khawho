/**
 * TEMPORARY STUB - For local development testing only
 * Remove this file before final commit - storage.js is written by another engineer
 */

export function listLocalQuizzes() {
  try {
    const stored = localStorage.getItem('khawho.quizzes');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function getLocalQuiz(id) {
  const quizzes = listLocalQuizzes();
  return quizzes.find(q => q.id === id);
}

export async function listLibrary() {
  // Stub: no library support in dev
  return [];
}

export async function loadLibraryQuiz(path, password) {
  throw new Error('Library not available in dev mode');
}

export function getTeacherPassword() {
  return localStorage.getItem('khawho.teacherPassword') || '';
}

export function setTeacherPassword(p) {
  localStorage.setItem('khawho.teacherPassword', p);
}
