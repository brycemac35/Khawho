/**
 * Quiz model: schema, validation, import/export
 */

import { randomId } from './rng.js';

export const ALLOWED_TIMES = [5, 10, 20, 30, 60, 90, 120];

/**
 * Create a new empty quiz.
 * @returns {Object}
 */
export function newQuiz() {
  return {
    format: 'khawho-quiz',
    v: 1,
    id: randomId(),
    title: '',
    author: '',
    updated: new Date().toISOString(),
    questions: [],
  };
}

/**
 * Create a new question of the given type.
 * @param {string} type - 'mc' (default), 'tf', 'type', or 'poll'
 * @returns {Object}
 */
export function newQuestion(type = 'mc') {
  const base = {
    type,
    text: '',
    image: null,
    timeLimit: 20,
    points: 'standard',
  };

  if (type === 'tf') {
    return {
      ...base,
      answers: [
        { text: 'True', correct: false },
        { text: 'False', correct: false },
      ],
    };
  } else if (type === 'type') {
    return {
      ...base,
      answers: [],
      accepted: [],
    };
  } else {
    // mc or poll
    return {
      ...base,
      answers: [],
    };
  }
}

/**
 * Validate a quiz. Returns {ok: boolean, errors: [{qIndex?, message}]}.
 * @param {Object} quiz
 * @returns {{ok: boolean, errors: Array}}
 */
export function validateQuiz(quiz) {
  const errors = [];

  if (!quiz.title || quiz.title.trim() === '') {
    errors.push({ message: 'Quiz title is required' });
  }

  if (!quiz.questions || quiz.questions.length === 0) {
    errors.push({ message: 'Quiz must have at least 1 question' });
  }

  quiz.questions?.forEach((q, qIndex) => {
    if (!q.text || q.text.trim() === '') {
      errors.push({ qIndex, message: 'Question text is required' });
    }

    if (!ALLOWED_TIMES.includes(q.timeLimit)) {
      errors.push({ qIndex, message: `Time limit must be one of: ${ALLOWED_TIMES.join(', ')}` });
    }

    if (!['standard', 'double', 'none'].includes(q.points)) {
      errors.push({ qIndex, message: 'Points must be standard, double, or none' });
    }

    if (q.type === 'mc') {
      const ansCount = q.answers?.length || 0;
      if (ansCount < 2 || ansCount > 4) {
        errors.push({ qIndex, message: 'MC questions need 2 to 4 answers' });
      }
      if (!q.answers?.some(a => a.correct)) {
        errors.push({ qIndex, message: 'MC question must have at least one correct answer' });
      }
    } else if (q.type === 'tf') {
      if (!q.answers?.some(a => a.correct)) {
        errors.push({ qIndex, message: 'TF question must have one correct answer' });
      }
    } else if (q.type === 'type') {
      if (!q.accepted || q.accepted.length === 0) {
        errors.push({ qIndex, message: 'Type-answer question must have at least one accepted answer' });
      }
    } else if (q.type === 'poll') {
      const ansCount = q.answers?.length || 0;
      if (ansCount < 2) {
        errors.push({ qIndex, message: 'Poll must have at least 2 options' });
      }
    } else {
      errors.push({ qIndex, message: `Unknown question type: ${q.type}` });
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Normalize a quiz by filling defaults and coercing invalid values.
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeQuiz(raw) {
  const quiz = { ...raw };

  // Fill in missing top-level fields
  if (!quiz.format) quiz.format = 'khawho-quiz';
  if (!quiz.v) quiz.v = 1;
  if (!quiz.id) quiz.id = randomId();
  if (!quiz.title) quiz.title = '';
  if (!quiz.author) quiz.author = '';
  if (!quiz.updated) quiz.updated = new Date().toISOString();
  if (!quiz.questions) quiz.questions = [];

  // Normalize each question
  quiz.questions = quiz.questions.map(q => {
    const normalized = { ...q };
    if (!normalized.text) normalized.text = '';
    if (normalized.image === undefined) normalized.image = null;
    if (!normalized.timeLimit) normalized.timeLimit = 20;
    if (!normalized.points) normalized.points = 'standard';

    // Coerce timeLimit to nearest valid value
    if (!ALLOWED_TIMES.includes(normalized.timeLimit)) {
      const closest = ALLOWED_TIMES.reduce((prev, curr) =>
        Math.abs(curr - normalized.timeLimit) < Math.abs(prev - normalized.timeLimit) ? curr : prev,
      );
      normalized.timeLimit = closest;
    }

    // Ensure answers is an array
    if (!normalized.answers) normalized.answers = [];

    // For type-answer questions, ensure accepted list
    if (normalized.type === 'type' && !normalized.accepted) {
      normalized.accepted = [];
    }

    return normalized;
  });

  return quiz;
}

/**
 * Convert quiz to JSON string.
 * @param {Object} quiz
 * @returns {string}
 */
export function quizToJSON(quiz) {
  return JSON.stringify(quiz, null, 2);
}

/**
 * Parse quiz from JSON string.
 * @param {string} json
 * @returns {Object}
 */
export function quizFromJSON(json) {
  return normalizeQuiz(JSON.parse(json));
}

/**
 * Parse CSV string with proper handling of quoted fields.
 * @param {string} csvLine
 * @returns {Array<string>}
 */
function parseCSVLine(csvLine) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvLine.length; i++) {
    const ch = csvLine[i];
    const nextCh = csvLine[i + 1];

    if (ch === '"') {
      if (inQuotes && nextCh === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Convert quiz to CSV format.
 * @param {Object} quiz
 * @returns {string}
 */
export function quizToCSV(quiz) {
  const rows = [];
  rows.push('type,question,a1,a2,a3,a4,correct,time');

  quiz.questions.forEach(q => {
    const type = q.type;
    const question = q.text.includes('"') ? `"${q.text.replace(/"/g, '""')}"` : q.text;
    const a1 = q.answers[0]?.text || '';
    const a2 = q.answers[1]?.text || '';
    const a3 = q.answers[2]?.text || '';
    const a4 = q.answers[3]?.text || '';

    let correct = '';
    if (q.type === 'type') {
      correct = q.accepted?.join('|') || '';
    } else {
      const correctIndices = q.answers
        .map((a, i) => a.correct ? i + 1 : null)
        .filter(i => i !== null);
      correct = correctIndices.join(';');
    }

    const row = [type, question, a1, a2, a3, a4, correct, q.timeLimit].map(field => {
      if (typeof field === 'string' && (field.includes(',') || field.includes('\n') || field.includes('"'))) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    });

    rows.push(row.join(','));
  });

  return rows.join('\n');
}

/**
 * Parse CSV lines properly handling multi-line quoted fields.
 * @param {string} csv
 * @returns {Array<Array<string>>}
 */
function parseCSVLines(csv) {
  const lines = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    const nextCh = csv[i + 1];

    if (ch === '"') {
      if (inQuotes && nextCh === '"') {
        // Escaped quote
        currentLine += '""';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
        currentLine += ch;
      }
    } else if (ch === '\n' && !inQuotes) {
      // End of line only if not in quotes
      if (currentLine.trim().length > 0) {
        lines.push(currentLine.trim());
      }
      currentLine = '';
    } else {
      currentLine += ch;
    }
  }

  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim());
  }

  return lines;
}

/**
 * Parse quiz from CSV string.
 * @param {string} csv
 * @returns {Object}
 */
export function quizFromCSV(csv) {
  // Remove BOM if present
  let cleaned = csv;
  if (cleaned.charCodeAt(0) === 0xfeff) {
    cleaned = cleaned.slice(1);
  }

  const lines = parseCSVLines(cleaned);
  const headers = parseCSVLine(lines[0]);

  const headerMap = {};
  headers.forEach((h, i) => {
    headerMap[h.toLowerCase()] = i;
  });

  const quiz = newQuiz();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const type = fields[headerMap['type']]?.trim() || 'mc';
    const text = fields[headerMap['question']]?.trim() || '';
    const a1 = fields[headerMap['a1']]?.trim() || '';
    const a2 = fields[headerMap['a2']]?.trim() || '';
    const a3 = fields[headerMap['a3']]?.trim() || '';
    const a4 = fields[headerMap['a4']]?.trim() || '';
    const correctField = fields[headerMap['correct']]?.trim() || '';
    const timeStr = fields[headerMap['time']]?.trim() || '20';

    const timeLimit = Math.max(5, Math.min(120, parseInt(timeStr) || 20));

    // Check if this is True/False
    if (
      type === 'mc' &&
      a1.toLowerCase() === 'true' &&
      a2.toLowerCase() === 'false' &&
      !a3
    ) {
      // Convert to TF
      const q = newQuestion('tf');
      q.text = text;
      q.timeLimit = timeLimit;
      const correctIdx = parseInt(correctField) || 1;
      q.answers[0].correct = correctIdx === 1;
      q.answers[1].correct = correctIdx === 2;
      quiz.questions.push(q);
    } else if (type === 'type') {
      // Type-answer: accepted answers can be in a1 field (pipe-separated) or correct field
      const q = newQuestion('type');
      q.text = text;
      q.timeLimit = timeLimit;
      // Check if a1 contains pipes (alternative format)
      if (a1.includes('|')) {
        q.accepted = a1
          .split('|')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      } else {
        // Use correct field
        q.accepted = correctField
          .split('|')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      }
      quiz.questions.push(q);
    } else {
      // MC or poll
      const answers = [a1, a2, a3, a4].filter(a => a.length > 0).map(text => ({
        text,
        correct: false,
      }));

      // Parse correct answer(s)
      const correctIndices = new Set();
      if (correctField.includes(';')) {
        correctField.split(';').forEach(idx => {
          const i = parseInt(idx) - 1;
          if (i >= 0 && i < answers.length) correctIndices.add(i);
        });
      } else {
        const idx = parseInt(correctField) - 1;
        if (idx >= 0 && idx < answers.length) correctIndices.add(idx);
      }

      answers.forEach((a, i) => {
        a.correct = correctIndices.has(i);
      });

      const q = newQuestion('mc');
      q.text = text;
      q.timeLimit = timeLimit;
      q.answers = answers;
      quiz.questions.push(q);
    }
  }

  return quiz;
}

/**
 * Import quiz from Kahoot xlsx rows (2D array from SheetJS).
 * @param {Array<Array>} rows - result of sheet_to_json with header:1
 * @returns {Object}
 */
export function quizFromKahootRows(rows) {
  // Find the header row containing 'Question'
  let headerRowIdx = -1;
  let headers = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('question'))) {
      headerRowIdx = i;
      headers = row.map(h => (typeof h === 'string' ? h.toLowerCase().trim() : ''));
      break;
    }
  }

  if (headerRowIdx === -1) {
    // No header row found, assume first row is header
    headerRowIdx = 0;
    headers = rows[0].map(h => (typeof h === 'string' ? h.toLowerCase().trim() : ''));
  }

  // Build header map
  const headerMap = {};
  headers.forEach((h, i) => {
    headerMap[h] = i;
  });

  const quiz = newQuiz();

  // Process data rows
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || !row[headerMap['question']]) continue;

    const text = String(row[headerMap['question']] || '').trim();
    const a1 = String(row[headerMap['answer 1']] || '').trim();
    const a2 = String(row[headerMap['answer 2']] || '').trim();
    const a3 = String(row[headerMap['answer 3']] || '').trim();
    const a4 = String(row[headerMap['answer 4']] || '').trim();
    const correctField = String(row[headerMap['correct answer(s)']] || '').trim();
    const timeStr = String(row[headerMap['time limit (sec)']] || '20').trim();

    const timeLimit = Math.max(5, Math.min(120, parseInt(timeStr) || 20));

    // Check if this is True/False
    if (
      a1.toLowerCase() === 'true' &&
      a2.toLowerCase() === 'false' &&
      !a3
    ) {
      const q = newQuestion('tf');
      q.text = text;
      q.timeLimit = timeLimit;
      const correctIdx = parseInt(correctField) || 1;
      q.answers[0].correct = correctIdx === 1;
      q.answers[1].correct = correctIdx === 2;
      quiz.questions.push(q);
    } else {
      // MC
      const answers = [a1, a2, a3, a4].filter(a => a.length > 0).map(text => ({
        text,
        correct: false,
      }));

      // Parse correct answer(s) - can be "1" or "1,3"
      const correctIndices = new Set();
      correctField.split(',').forEach(idx => {
        const i = parseInt(idx.trim()) - 1;
        if (i >= 0 && i < answers.length) correctIndices.add(i);
      });

      answers.forEach((a, idx) => {
        a.correct = correctIndices.has(idx);
      });

      const q = newQuestion('mc');
      q.text = text;
      q.timeLimit = timeLimit;
      q.answers = answers;
      quiz.questions.push(q);
    }
  }

  return quiz;
}

/**
 * Check if a typed answer matches one of the accepted answers.
 * Normalizes by trimming, lowercasing, and collapsing whitespace.
 * @param {Object} question - a type-answer question
 * @param {string} text - the user's answer
 * @returns {boolean}
 */
export function checkTypeAnswer(question, text) {
  const normalize = str =>
    String(str).trim().toLowerCase().replace(/\s+/g, ' ');

  const normalized = normalize(text);
  return question.accepted?.some(accepted => normalize(accepted) === normalized) || false;
}
