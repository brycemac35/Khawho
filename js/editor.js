/**
 * Quiz Editor UI
 */

import {
  newQuiz,
  newQuestion,
  validateQuiz,
  quizToJSON,
  quizFromJSON,
  quizToCSV,
  quizFromCSV,
  quizFromKahootRows,
} from './quiz.js';
import {
  listLocalQuizzes,
  saveLocalQuiz,
  deleteLocalQuiz,
  getLocalQuiz,
  listLibrary,
  loadLibraryQuiz,
  saveLibraryQuiz,
  deleteLibraryQuiz,
  getTeacherPassword,
  setTeacherPassword,
  forgetTeacherPassword,
  getGithubToken,
  setGithubToken,
  forgetGithubToken,
  checkGithubToken,
} from './storage.js';

let currentQuiz = null;
let currentQuizSource = null; // 'local' or 'lib'
let currentLibraryPath = null;
let autosaveTimer = null;
let libraryQuizzes = [];

// DOM elements
const quizEditorDiv = document.getElementById('quizEditor');
const noQuizDiv = document.getElementById('noQuizSelected');
const myQuizzesListDiv = document.getElementById('myQuizzesList');
const libraryListDiv = document.getElementById('libraryList');
const myQuizzesSearchInput = document.getElementById('myQuizzesSearch');
const librarySearchInput = document.getElementById('librarySearch');
const quizTitleInput = document.getElementById('quizTitle');
const quizAuthorInput = document.getElementById('quizAuthor');
const questionsListDiv = document.getElementById('questionsList');
const validationDiv = document.getElementById('validationMessages');
const autosaveIndicator = document.getElementById('autosaveIndicator');
const settingsPanel = document.getElementById('settingsPanel');
const libraryStatusDiv = document.getElementById('libraryStatus');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  renderMyQuizzes();
  loadLibrary();
});

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tabName + '-tab').classList.add('active');
    });
  });

  // New Quiz
  document.getElementById('newQuizBtn').addEventListener('click', () => {
    currentQuiz = newQuiz();
    currentQuizSource = 'local';
    currentLibraryPath = null;
    renderQuizEditor();
  });

  // Import
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importModal').classList.add('active');
  });

  document.getElementById('closeImportBtn').addEventListener('click', () => {
    document.getElementById('importModal').classList.remove('active');
  });

  document.getElementById('importJsonBtn').addEventListener('click', () => {
    document.getElementById('importFile').accept = '.json';
    document.getElementById('importFile').click();
  });

  document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('importFile').accept = '.csv';
    document.getElementById('importFile').click();
  });

  document.getElementById('importXlsxBtn').addEventListener('click', () => {
    // This would load SheetJS from CDN
    document.getElementById('importFile').accept = '.xlsx';
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', handleFileImport);

  document.getElementById('loadSampleBtn').addEventListener('click', () => {
    loadSampleQuiz();
  });

  // Add Question
  document.getElementById('addQuestionBtn').addEventListener('click', () => {
    const q = newQuestion('mc');
    currentQuiz.questions.push(q);
    renderQuestions();
    debounceAutosave();
  });

  // Quiz metadata
  quizTitleInput.addEventListener('input', () => {
    if (currentQuiz) {
      currentQuiz.title = quizTitleInput.value;
      debounceAutosave();
    }
  });

  quizAuthorInput.addEventListener('input', () => {
    if (currentQuiz) {
      currentQuiz.author = quizAuthorInput.value;
      debounceAutosave();
    }
  });

  // Export
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!currentQuiz) return;
    const json = quizToJSON(currentQuiz);
    downloadFile(json, `${currentQuiz.title || 'quiz'}.json`, 'application/json');
  });

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    if (!currentQuiz) return;
    const csv = quizToCSV(currentQuiz);
    downloadFile(csv, `${currentQuiz.title || 'quiz'}.csv`, 'text/csv');
  });

  // Host
  document.getElementById('hostBtn').addEventListener('click', () => {
    if (!currentQuiz) return;
    if (currentQuizSource === 'local') {
      window.location.href = `host.html?quiz=local:${currentQuiz.id}`;
    } else if (currentLibraryPath) {
      window.location.href = `host.html?quiz=lib:${encodeURIComponent(currentLibraryPath)}`;
    }
  });

  // Save to Library
  document.getElementById('saveLibraryBtn').addEventListener('click', () => {
    if (!currentQuiz) return;
    saveToLibrary();
  });

  // Delete
  document.getElementById('deleteBtn').addEventListener('click', () => {
    if (!currentQuiz) return;
    if (currentQuizSource === 'local') {
      showConfirm('Delete Quiz?', 'This quiz will be deleted from your device.', () => {
        deleteLocalQuiz(currentQuiz.id);
        currentQuiz = null;
        renderMyQuizzes();
        renderQuizEditor();
      });
    }
  });

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    settingsPanel.classList.add('active');
    loadSettingsPanel();
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    settingsPanel.classList.remove('active');
  });

  document.getElementById('setPasswordBtn').addEventListener('click', () => {
    const pwd = document.getElementById('passwordInput').value;
    if (pwd) {
      setTeacherPassword(pwd);
      document.getElementById('passwordInput').value = '';
      showMessage('settingsPanel', 'Password saved!', 'success');
    }
  });

  document.getElementById('forgetPasswordBtn').addEventListener('click', () => {
    forgetTeacherPassword();
    showMessage('settingsPanel', 'Password forgotten.', 'success');
  });

  document.getElementById('checkTokenBtn').addEventListener('click', async () => {
    const token = document.getElementById('tokenInput').value;
    if (!token) {
      showMessage('settingsPanel', 'Token is required', 'error');
      return;
    }
    const result = await checkGithubToken(token);
    if (result.ok) {
      setGithubToken(token);
      document.getElementById('tokenInput').value = '';
      showMessage('settingsPanel', result.message, 'success');
    } else {
      showMessage('settingsPanel', result.message, 'error');
    }
  });

  document.getElementById('forgetTokenBtn').addEventListener('click', () => {
    forgetGithubToken();
    showMessage('settingsPanel', 'Token forgotten.', 'success');
  });

  // Search
  myQuizzesSearchInput.addEventListener('input', renderMyQuizzes);
  librarySearchInput.addEventListener('input', renderLibrary);
}

function renderMyQuizzes() {
  const quizzes = listLocalQuizzes();
  const search = myQuizzesSearchInput.value.toLowerCase();
  const filtered = quizzes.filter(
    q => q.title.toLowerCase().includes(search) || q.author.toLowerCase().includes(search),
  );

  myQuizzesListDiv.innerHTML = filtered
    .map(
      q => `
    <div class="quiz-list-item ${currentQuiz?.id === q.id ? 'active' : ''}" data-id="${q.id}">
      <div class="quiz-list-item-title">${q.title || 'Untitled'}</div>
      <div class="quiz-list-item-meta">${q.author || 'No author'} • ${q.questions?.length || 0} questions</div>
    </div>
  `,
    )
    .join('');

  myQuizzesListDiv.querySelectorAll('.quiz-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      currentQuiz = getLocalQuiz(id);
      currentQuizSource = 'local';
      currentLibraryPath = null;
      renderMyQuizzes();
      renderQuizEditor();
    });
  });
}

async function loadLibrary() {
  libraryStatusDiv.innerHTML = '<div class="inline-message info">Loading library...</div>';
  try {
    libraryQuizzes = await listLibrary();
    renderLibrary();
    libraryStatusDiv.innerHTML = '';
  } catch (err) {
    libraryStatusDiv.innerHTML = `<div class="inline-message error">${err.message}</div>`;
  }
}

function renderLibrary() {
  const search = librarySearchInput.value.toLowerCase();
  const filtered = libraryQuizzes.filter(
    q => q.title.toLowerCase().includes(search) || q.author.toLowerCase().includes(search),
  );

  libraryListDiv.innerHTML = filtered
    .map(
      q => `
    <div class="quiz-list-item ${currentLibraryPath === q.path ? 'active' : ''}" data-path="${q.path}">
      <div class="quiz-list-item-title">${q.title || 'Untitled'}</div>
      <div class="quiz-list-item-meta">${q.author || 'No author'} • ${q.count || 0} questions</div>
      <div class="flex gap-sm" style="margin-top: var(--spacing-sm)">
        <button class="question-control-btn" data-action="open" data-path="${q.path}">Open</button>
        <button class="question-control-btn" data-action="copy" data-path="${q.path}">Copy</button>
        <button class="question-control-btn" data-action="delete" data-path="${q.path}" data-sha="${q.sha}">Delete</button>
      </div>
    </div>
  `,
    )
    .join('');

  libraryListDiv.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const action = btn.dataset.action;
      const path = btn.dataset.path;
      const sha = btn.dataset.sha;
      const quiz = libraryQuizzes.find(q => q.path === path);

      if (action === 'open') {
        const pwd = getTeacherPassword();
        if (!pwd) {
          promptPassword(async password => {
            try {
              const loaded = await loadLibraryQuiz(path, password);
              currentQuiz = loaded;
              currentQuizSource = 'lib';
              currentLibraryPath = path;
              renderQuizEditor();
            } catch (err) {
              showMessage('library-tab', err.message, 'error');
            }
          });
        } else {
          try {
            const loaded = await loadLibraryQuiz(path, pwd);
            currentQuiz = loaded;
            currentQuizSource = 'lib';
            currentLibraryPath = path;
            renderQuizEditor();
          } catch (err) {
            showMessage('library-tab', err.message, 'error');
          }
        }
      } else if (action === 'copy') {
        try {
          const pwd = getTeacherPassword();
          const loaded = await loadLibraryQuiz(path, pwd);
          const { randomId } = await import('./rng.js');
          loaded.id = randomId(); // new ID
          saveLocalQuiz(loaded);
          currentQuiz = loaded;
          currentQuizSource = 'local';
          currentLibraryPath = null;
          renderMyQuizzes();
          renderQuizEditor();
          showMessage('editorMain', 'Quiz copied to your quizzes!', 'success');
        } catch (err) {
          showMessage('library-tab', err.message, 'error');
        }
      } else if (action === 'delete') {
        const token = getGithubToken();
        if (!token) {
          showMessage('library-tab', 'GitHub token required to delete', 'error');
          return;
        }
        showConfirm('Delete from Library?', `Delete "${quiz.title}"? This cannot be undone.`, async () => {
          try {
            await deleteLibraryQuiz(path, sha, token);
            libraryQuizzes = libraryQuizzes.filter(q => q.path !== path);
            renderLibrary();
            showMessage('library-tab', 'Quiz deleted from library.', 'success');
          } catch (err) {
            showMessage('library-tab', err.message, 'error');
          }
        });
      }
    });
  });
}

function renderQuizEditor() {
  if (!currentQuiz) {
    quizEditorDiv.style.display = 'none';
    noQuizDiv.style.display = 'flex';
    myQuizzesListDiv.querySelectorAll('.quiz-list-item').forEach(i => i.classList.remove('active'));
    return;
  }

  quizEditorDiv.style.display = 'flex';
  noQuizDiv.style.display = 'none';

  quizTitleInput.value = currentQuiz.title || '';
  quizAuthorInput.value = currentQuiz.author || '';

  renderQuestions();
  renderValidation();
}

function renderQuestions() {
  questionsListDiv.innerHTML = currentQuiz.questions
    .map(
      (q, idx) => `
    <div class="question-editor">
      <div class="question-header">
        <div class="question-number">Q${idx + 1}</div>
        <select class="question-type-select" data-idx="${idx}">
          <option value="mc" ${q.type === 'mc' ? 'selected' : ''}>Multiple Choice</option>
          <option value="tf" ${q.type === 'tf' ? 'selected' : ''}>True or False</option>
          <option value="type" ${q.type === 'type' ? 'selected' : ''}>Type the Answer</option>
          <option value="poll" ${q.type === 'poll' ? 'selected' : ''}>Poll</option>
        </select>
        <div class="question-controls">
          <button class="question-control-btn" data-action="duplicate" data-idx="${idx}">Duplicate</button>
          <button class="question-control-btn" data-action="delete" data-idx="${idx}">Delete</button>
          ${idx > 0 ? `<button class="question-control-btn" data-action="up" data-idx="${idx}">↑</button>` : ''}
          ${idx < currentQuiz.questions.length - 1 ? `<button class="question-control-btn" data-action="down" data-idx="${idx}">↓</button>` : ''}
        </div>
      </div>

      <div class="form-group">
        <label>Question Text</label>
        <textarea data-idx="${idx}" data-field="text" class="question-text" rows="3">${q.text || ''}</textarea>
      </div>

      <div class="form-group">
        <label>Image URL (optional)</label>
        <input type="text" data-idx="${idx}" data-field="image" class="question-image" placeholder="https://..." value="${q.image || ''}" />
      </div>

      <div class="flex gap-lg" style="margin-bottom: var(--spacing-md)">
        <div class="form-group" style="flex: 1">
          <label>Time Limit (sec)</label>
          <select data-idx="${idx}" data-field="timeLimit" class="question-time">
            <option value="5" ${q.timeLimit === 5 ? 'selected' : ''}>5</option>
            <option value="10" ${q.timeLimit === 10 ? 'selected' : ''}>10</option>
            <option value="20" ${q.timeLimit === 20 ? 'selected' : ''}>20</option>
            <option value="30" ${q.timeLimit === 30 ? 'selected' : ''}>30</option>
            <option value="60" ${q.timeLimit === 60 ? 'selected' : ''}>60</option>
            <option value="90" ${q.timeLimit === 90 ? 'selected' : ''}>90</option>
            <option value="120" ${q.timeLimit === 120 ? 'selected' : ''}>120</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1">
          <label>Points</label>
          <select data-idx="${idx}" data-field="points" class="question-points">
            <option value="standard" ${q.points === 'standard' ? 'selected' : ''}>Standard</option>
            <option value="double" ${q.points === 'double' ? 'selected' : ''}>Double</option>
            <option value="none" ${q.points === 'none' ? 'selected' : ''}>None</option>
          </select>
        </div>
      </div>

      ${renderAnswers(q, idx)}
    </div>
  `,
    )
    .join('');

  // Setup event listeners for questions
  questionsListDiv.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const idx = parseInt(btn.dataset.idx);

      if (action === 'delete') {
        currentQuiz.questions.splice(idx, 1);
      } else if (action === 'duplicate') {
        currentQuiz.questions.splice(idx + 1, 0, JSON.parse(JSON.stringify(currentQuiz.questions[idx])));
      } else if (action === 'up' && idx > 0) {
        [currentQuiz.questions[idx], currentQuiz.questions[idx - 1]] = [
          currentQuiz.questions[idx - 1],
          currentQuiz.questions[idx],
        ];
      } else if (action === 'down' && idx < currentQuiz.questions.length - 1) {
        [currentQuiz.questions[idx], currentQuiz.questions[idx + 1]] = [
          currentQuiz.questions[idx + 1],
          currentQuiz.questions[idx],
        ];
      }

      renderQuestions();
      debounceAutosave();
    });
  });

  questionsListDiv.querySelectorAll('.question-type-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      const newType = sel.value;
      const oldQ = currentQuiz.questions[idx];

      // Create new question of new type, copy text/timeLimit/points
      const newQ = newQuestion(newType);
      newQ.text = oldQ.text;
      newQ.timeLimit = oldQ.timeLimit;
      newQ.points = oldQ.points;
      newQ.image = oldQ.image;

      currentQuiz.questions[idx] = newQ;
      renderQuestions();
      debounceAutosave();
    });
  });

  questionsListDiv.querySelectorAll('.question-text, .question-image').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.idx);
      const field = input.dataset.field;
      currentQuiz.questions[idx][field] = input.value;
      debounceAutosave();
    });
  });

  questionsListDiv.querySelectorAll('.question-time, .question-points').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      const field = sel.dataset.field;
      const value = sel.value;
      if (field === 'timeLimit') {
        currentQuiz.questions[idx].timeLimit = parseInt(value);
      } else {
        currentQuiz.questions[idx].points = value;
      }
      debounceAutosave();
    });
  });

  // Answer handlers
  questionsListDiv.querySelectorAll('[data-answer-field]').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.idx);
      const ansIdx = parseInt(input.dataset.ansIdx);
      const field = input.dataset.answerField;

      if (field === 'text') {
        currentQuiz.questions[idx].answers[ansIdx].text = input.value;
      } else if (field === 'correct') {
        currentQuiz.questions[idx].answers[ansIdx].correct = input.checked;
      }

      debounceAutosave();
    });
  });

  questionsListDiv.querySelectorAll('[data-accepted-field]').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.idx);
      currentQuiz.questions[idx].accepted = input.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      debounceAutosave();
    });
  });
}

function renderAnswers(q, qIdx) {
  if (q.type === 'mc' || q.type === 'poll') {
    const colors = ['red', 'blue', 'yellow', 'green'];
    return `
      <div class="form-group">
        <label>Answers</label>
        <div class="answer-colors">
          ${q.answers
            .map(
              (a, ansIdx) => `
            <div class="answer-color">
              <div class="answer-color-label">
                <div class="answer-color-name" style="background: var(--color-${colors[ansIdx]})">
                  ${colors[ansIdx].toUpperCase()}
                </div>
              </div>
              <input type="text" class="answer-color-input" data-idx="${qIdx}" data-ans-idx="${ansIdx}" data-answer-field="text" placeholder="Answer ${ansIdx + 1}" value="${a.text}" />
              ${q.type === 'mc' ? `
                <label class="answer-correct">
                  <input type="checkbox" data-idx="${qIdx}" data-ans-idx="${ansIdx}" data-answer-field="correct" ${a.correct ? 'checked' : ''} />
                  Correct
                </label>
              ` : ''}
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  } else if (q.type === 'tf') {
    return `
      <div class="form-group">
        <label>Answers (True/False)</label>
        <div class="flex gap-md">
          <label class="answer-correct" style="flex: 1">
            <input type="checkbox" data-idx="${qIdx}" data-ans-idx="0" data-answer-field="correct" ${q.answers[0]?.correct ? 'checked' : ''} />
            True is correct
          </label>
          <label class="answer-correct" style="flex: 1">
            <input type="checkbox" data-idx="${qIdx}" data-ans-idx="1" data-answer-field="correct" ${q.answers[1]?.correct ? 'checked' : ''} />
            False is correct
          </label>
        </div>
      </div>
    `;
  } else if (q.type === 'type') {
    return `
      <div class="form-group">
        <label>Accepted Answers (one per line)</label>
        <textarea data-idx="${qIdx}" data-accepted-field="accepted" rows="4" placeholder="answer&#10;alternative spelling&#10;another variant">${q.accepted?.join('\n') || ''}</textarea>
      </div>
    `;
  }
}

function renderValidation() {
  const result = validateQuiz(currentQuiz);
  if (result.ok) {
    validationDiv.innerHTML = '<div class="validation-success">✓ Quiz is valid and ready!</div>';
  } else {
    const errors = result.errors
      .map(e => {
        if (e.qIndex !== undefined) {
          return `Question ${e.qIndex + 1}: ${e.message}`;
        }
        return e.message;
      })
      .join('<br>');
    validationDiv.innerHTML = `<div class="validation-error">✗ ${errors}</div>`;
  }
}

function debounceAutosave() {
  clearTimeout(autosaveTimer);
  autosaveIndicator.textContent = '⏱ Saving...';
  autosaveIndicator.classList.add('saving');
  autosaveTimer = setTimeout(() => {
    if (currentQuiz && currentQuizSource === 'local') {
      currentQuiz.updated = new Date().toISOString();
      saveLocalQuiz(currentQuiz);
      autosaveIndicator.textContent = '✓ Saved';
      autosaveIndicator.classList.remove('saving');
      autosaveIndicator.classList.add('saved');
      setTimeout(() => {
        autosaveIndicator.textContent = '';
        autosaveIndicator.classList.remove('saved');
      }, 2000);
    }
  }, 1000);
}

async function saveToLibrary() {
  const pwd = getTeacherPassword();
  const token = getGithubToken();

  if (!pwd) {
    promptPassword(p => {
      setTeacherPassword(p);
      saveToLibrary();
    });
    return;
  }

  if (!token) {
    showMessage(
      'editorMain',
      'GitHub token required. Go to Settings and add your token.',
      'error',
    );
    return;
  }

  try {
    const result = validateQuiz(currentQuiz);
    if (!result.ok) {
      showMessage('editorMain', 'Fix validation errors before saving to library.', 'error');
      return;
    }

    showMessage('editorMain', 'Saving to library...', 'info');
    const path = await saveLibraryQuiz(currentQuiz, pwd, token);
    showMessage('editorMain', `✓ Saved to library: ${path}`, 'success');
    libraryQuizzes = await listLibrary();
    renderLibrary();
  } catch (err) {
    showMessage('editorMain', err.message, 'error');
  }
}

async function handleFileImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();

    let quiz;
    if (file.name.endsWith('.json')) {
      quiz = quizFromJSON(text);
    } else if (file.name.endsWith('.csv')) {
      quiz = quizFromCSV(text);
    } else if (file.name.endsWith('.xlsx')) {
      const { default: XLSX } = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      quiz = quizFromKahootRows(rows);
    } else {
      throw new Error('Unsupported file type');
    }

    currentQuiz = quiz;
    currentQuizSource = 'local';
    currentLibraryPath = null;
    saveLocalQuiz(quiz);
    renderMyQuizzes();
    renderQuizEditor();
    document.getElementById('importModal').classList.remove('active');
    showMessage('editorMain', 'Quiz imported successfully!', 'success');
  } catch (err) {
    showMessage('importModal', err.message, 'error');
  }

  e.target.value = '';
}

async function loadSampleQuiz() {
  try {
    const response = await fetch('samples/sample-quiz.json');
    const quiz = await response.json();
    currentQuiz = quiz;
    currentQuizSource = 'local';
    currentLibraryPath = null;
    saveLocalQuiz(quiz);
    renderMyQuizzes();
    renderQuizEditor();
    document.getElementById('importModal').classList.remove('active');
    showMessage('editorMain', 'Sample quiz loaded!', 'success');
  } catch (err) {
    showMessage('importModal', err.message, 'error');
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showMessage(containerId, message, type) {
  const container = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className = `inline-message ${type}`;
  div.textContent = message;
  if (container) {
    container.insertBefore(div, container.firstChild);
    setTimeout(() => div.remove(), 5000);
  }
}

function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  modal.classList.add('active');

  const handleConfirm = () => {
    cleanup();
    onConfirm();
  };

  const handleCancel = () => {
    cleanup();
  };

  const cleanup = () => {
    modal.classList.remove('active');
    document.getElementById('confirmBtn').removeEventListener('click', handleConfirm);
    document.getElementById('cancelConfirmBtn').removeEventListener('click', handleCancel);
  };

  document.getElementById('confirmBtn').addEventListener('click', handleConfirm);
  document.getElementById('cancelConfirmBtn').addEventListener('click', handleCancel);
}

function promptPassword(onSubmit) {
  const modal = document.getElementById('passwordModal');
  const input = document.getElementById('passwordPromptInput');
  modal.classList.add('active');
  input.focus();

  const handleSubmit = () => {
    const pwd = input.value;
    cleanup();
    onSubmit(pwd);
  };

  const handleCancel = () => {
    cleanup();
  };

  const cleanup = () => {
    modal.classList.remove('active');
    input.value = '';
    document.getElementById('submitPasswordBtn').removeEventListener('click', handleSubmit);
    document.getElementById('cancelPasswordBtn').removeEventListener('click', handleCancel);
    input.removeEventListener('keypress', handleEnter);
  };

  const handleEnter = e => {
    if (e.key === 'Enter') handleSubmit();
  };

  document.getElementById('submitPasswordBtn').addEventListener('click', handleSubmit);
  document.getElementById('cancelPasswordBtn').addEventListener('click', handleCancel);
  input.addEventListener('keypress', handleEnter);
}

function loadSettingsPanel() {
  const pwd = getTeacherPassword();
  const token = getGithubToken();
  document.getElementById('passwordInput').placeholder = pwd ? 'Password set' : 'Enter password...';
  document.getElementById('tokenInput').placeholder = token ? 'Token set' : 'Paste token...';
}
