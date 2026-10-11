/**
 * Local and library storage for quizzes.
 * Local: localStorage
 * Library: GitHub API (quizzes/ folder)
 */

import { quizToJSON, quizFromJSON } from './quiz.js';
import { encryptQuiz, decryptQuiz, bytesToBase64 } from './crypto.js';
import { REPO_OWNER, REPO_NAME, QUIZ_DIR } from './config.js';

const STORAGE_KEY = 'khawho.quizzes';
const PASSWORD_KEY = 'khawho.teacherPassword';
const TOKEN_KEY = 'khawho.githubToken';

let libraryCache = null;
let libraryCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

/**
 * Convert a title to a URL-safe slug.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * List all quizzes stored locally.
 * @returns {Array<Object>}
 */
export function listLocalQuizzes() {
  try {
    const json = globalThis.localStorage?.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

/**
 * Get a specific local quiz by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function getLocalQuiz(id) {
  const quizzes = listLocalQuizzes();
  const stored = quizzes.find(q => q.id === id);
  if (!stored) return null;
  // The stored quizzes are full quiz objects
  return stored;
}

/**
 * Save a quiz locally.
 * @param {Object} quiz
 */
export function saveLocalQuiz(quiz) {
  const quizzes = listLocalQuizzes();
  const idx = quizzes.findIndex(q => q.id === quiz.id);
  if (idx >= 0) {
    quizzes[idx] = quiz;
  } else {
    quizzes.push(quiz);
  }
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(quizzes));
}

/**
 * Delete a local quiz.
 * @param {string} id
 */
export function deleteLocalQuiz(id) {
  const quizzes = listLocalQuizzes().filter(q => q.id !== id);
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(quizzes));
}

/**
 * Get the teacher password from localStorage.
 * @returns {string|null}
 */
export function getTeacherPassword() {
  return globalThis.localStorage?.getItem(PASSWORD_KEY) || null;
}

/**
 * Set the teacher password in localStorage.
 * @param {string} password
 */
export function setTeacherPassword(password) {
  globalThis.localStorage?.setItem(PASSWORD_KEY, password);
}

/**
 * Clear the teacher password from localStorage.
 */
export function forgetTeacherPassword() {
  globalThis.localStorage?.removeItem(PASSWORD_KEY);
}

/**
 * Get the GitHub token from localStorage.
 * @returns {string|null}
 */
export function getGithubToken() {
  return globalThis.localStorage?.getItem(TOKEN_KEY) || null;
}

/**
 * Set the GitHub token in localStorage.
 * @param {string} token
 */
export function setGithubToken(token) {
  globalThis.localStorage?.setItem(TOKEN_KEY, token);
}

/**
 * Clear the GitHub token from localStorage.
 */
export function forgetGithubToken() {
  globalThis.localStorage?.removeItem(TOKEN_KEY);
}

/**
 * Check if a GitHub token is valid and has permission to write to the repo.
 * @param {string} token
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function checkGithubToken(token) {
  if (!token) {
    return { ok: false, message: 'Token is required' };
  }

  try {
    const headers = {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${token}`,
    };

    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { ok: false, message: 'Invalid token' };
      } else if (response.status === 403) {
        return { ok: false, message: 'Token does not have permission' };
      } else if (response.status === 404) {
        return { ok: false, message: 'Repository not found' };
      }
      return { ok: false, message: `Server error: ${response.status}` };
    }

    const repo = await response.json();

    // Check if token has write permission
    if (!repo.permissions?.push) {
      return { ok: false, message: 'Token does not have write permission' };
    }

    return { ok: true, message: 'Token is valid and has write access' };
  } catch (error) {
    if (error.message === 'Failed to fetch') {
      return { ok: false, message: 'Offline or network error' };
    }
    return { ok: false, message: `Error: ${error.message}` };
  }
}

/**
 * List quizzes in the GitHub library.
 * @returns {Promise<Array<{path, name, sha, title, author, count, updated}>>}
 */
export async function listLibrary() {
  // Check cache
  if (libraryCache && Date.now() - libraryCacheTime < CACHE_TTL) {
    return libraryCache;
  }

  const token = getGithubToken();
  const headers = {
    Accept: 'application/vnd.github.v3+json',
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${QUIZ_DIR}`,
      { headers },
    );

    if (response.status === 404) {
      // Folder doesn't exist
      return [];
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const contents = await response.json();

    // Filter for .json files and fetch their content
    const files = contents.filter(item => item.name.endsWith('.json') && item.type === 'file');

    const quizzes = await Promise.all(
      files.map(async file => {
        try {
          // Fetch file content to get title/author/count from clear fields
          const fileResponse = await fetch(file.url, {
            headers: {
              Accept: 'application/vnd.github.v3.raw',
              ...headers,
            },
          });

          if (fileResponse.ok) {
            const content = await fileResponse.json();
            return {
              path: file.path,
              name: file.name,
              sha: file.sha,
              title: content.title || 'Untitled',
              author: content.author || '',
              count: content.count || 0,
              updated: content.updated || '',
            };
          }
        } catch {
          // If we can't fetch content, return minimal info
        }

        return {
          path: file.path,
          name: file.name,
          sha: file.sha,
          title: file.name.replace('.json', ''),
          author: '',
          count: 0,
          updated: '',
        };
      }),
    );

    libraryCache = quizzes;
    libraryCacheTime = Date.now();
    return quizzes;
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Offline or network error');
    }
    throw error;
  }
}

/**
 * Load a quiz from the GitHub library.
 * @param {string} path
 * @param {string} password
 * @returns {Promise<Object>}
 */
export async function loadLibraryQuiz(path, password = getTeacherPassword()) {
  if (!password) {
    throw new Error('Teacher password required');
  }

  const token = getGithubToken();
  const headers = {
    Accept: 'application/vnd.github.v3.raw',
  };

  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch quiz: ${response.status}`);
    }

    const encrypted = await response.json();
    return await decryptQuiz(encrypted, password);
  } catch (error) {
    if (error.message.includes('Wrong teacher password')) {
      throw error;
    }
    throw new Error(`Failed to load quiz: ${error.message}`);
  }
}

/**
 * Save a quiz to the GitHub library.
 * @param {Object} quiz
 * @param {string} password
 * @param {string} token
 * @returns {Promise<string>} file path
 */
export async function saveLibraryQuiz(quiz, password, token) {
  if (!token) {
    throw new Error('GitHub token required');
  }

  if (!password) {
    throw new Error('Teacher password required');
  }

  // Generate filename: slug-id6.json
  const slug = slugify(quiz.title || 'quiz');
  const id6 = quiz.id.substring(0, 6);
  const filename = `${slug}-${id6}.json`;
  const path = `${QUIZ_DIR}/${filename}`;

  // Encrypt the quiz
  const encrypted = await encryptQuiz(quiz, password);
  const content = JSON.stringify(encrypted, null, 2);
  const encodedContent = bytesToBase64(new TextEncoder().encode(content));

  // Check if file already exists
  let sha = null;
  try {
    const getResponse = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: `token ${token}`,
        },
      },
    );

    if (getResponse.ok) {
      const existing = await getResponse.json();
      sha = existing.sha;
    }
  } catch {
    // File doesn't exist yet
  }

  // Put the file
  const putResponse = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Save quiz: ${quiz.title}`,
        content: encodedContent,
        ...(sha && { sha }),
      }),
    },
  );

  if (!putResponse.ok) {
    const error = await putResponse.json();
    throw new Error(`Failed to save quiz: ${error.message || putResponse.statusText}`);
  }

  // Clear cache
  libraryCache = null;
  return path;
}

/**
 * Delete a quiz from the GitHub library.
 * @param {string} path
 * @param {string} sha
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function deleteLibraryQuiz(path, sha, token) {
  if (!token) {
    throw new Error('GitHub token required');
  }

  const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Delete quiz: ${path}`,
      sha,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to delete quiz: ${error.message || response.statusText}`);
  }

  // Clear cache
  libraryCache = null;
}
