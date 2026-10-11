import test from 'node:test';
import assert from 'node:assert';
import {
  ALLOWED_TIMES,
  newQuiz,
  newQuestion,
  validateQuiz,
  normalizeQuiz,
  quizToJSON,
  quizFromJSON,
  quizToCSV,
  quizFromCSV,
  quizFromKahootRows,
  checkTypeAnswer,
} from '../js/quiz.js';

test('ALLOWED_TIMES constant', () => {
  assert(Array.isArray(ALLOWED_TIMES));
  assert.deepStrictEqual(ALLOWED_TIMES, [5, 10, 20, 30, 60, 90, 120]);
});

test('newQuiz creates a valid quiz', () => {
  const quiz = newQuiz();
  assert(quiz.format === 'khawho-quiz');
  assert(quiz.v === 1);
  assert(typeof quiz.id === 'string');
  assert(quiz.id.length > 0);
  assert(quiz.title === '');
  assert(quiz.author === '');
  assert(typeof quiz.updated === 'string');
  assert(Array.isArray(quiz.questions));
  assert(quiz.questions.length === 0);
});

test('newQuestion creates mc by default', () => {
  const q = newQuestion();
  assert(q.type === 'mc');
  assert(q.text === '');
  assert(q.image === null);
  assert(q.timeLimit === 20);
  assert(q.points === 'standard');
  assert(Array.isArray(q.answers));
  assert(q.answers.length === 0);
  assert(!('accepted' in q));
});

test('newQuestion creates tf', () => {
  const q = newQuestion('tf');
  assert(q.type === 'tf');
  assert(Array.isArray(q.answers));
  assert(q.answers.length === 2);
  assert(q.answers[0].text === 'True');
  assert(q.answers[0].correct === false);
  assert(q.answers[1].text === 'False');
  assert(q.answers[1].correct === false);
});

test('newQuestion creates type-answer', () => {
  const q = newQuestion('type');
  assert(q.type === 'type');
  assert(Array.isArray(q.accepted));
  assert(q.accepted.length === 0);
  assert(q.answers.length === 0);
});

test('newQuestion creates poll', () => {
  const q = newQuestion('poll');
  assert(q.type === 'poll');
  assert(Array.isArray(q.answers));
});

test('validateQuiz rejects empty title', () => {
  const quiz = newQuiz();
  quiz.title = '';
  const result = validateQuiz(quiz);
  assert(!result.ok);
  assert(result.errors.length > 0);
  assert(result.errors.some(e => e.message.includes('title')));
});

test('validateQuiz rejects quiz with no questions', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const result = validateQuiz(quiz);
  assert(!result.ok);
  assert(result.errors.some(e => e.message.includes('at least 1 question')));
});

test('validateQuiz rejects mc question with no answers', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
  assert(result.errors.some(e => e.qIndex === 0 && e.message.includes('answers')));
});

test('validateQuiz rejects mc question with only 1 answer', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [{ text: 'Answer', correct: true }];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
  assert(result.errors.some(e => e.qIndex === 0 && e.message.includes('2 to 4')));
});

test('validateQuiz rejects mc question with >4 answers', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: false },
    { text: 'B', correct: false },
    { text: 'C', correct: false },
    { text: 'D', correct: false },
    { text: 'E', correct: false },
  ];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
});

test('validateQuiz rejects mc question with no correct answers', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: false },
    { text: 'B', correct: false },
  ];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
  assert(result.errors.some(e => e.qIndex === 0 && e.message.includes('correct')));
});

test('validateQuiz rejects tf question with no correct answer', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('tf');
  q.text = 'Question?';
  q.answers[0].correct = false;
  q.answers[1].correct = false;
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
});

test('validateQuiz rejects type-answer with empty accepted list', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('type');
  q.text = 'Question?';
  q.accepted = [];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
});

test('validateQuiz rejects invalid timeLimit', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
  ];
  q.timeLimit = 25; // not in ALLOWED_TIMES
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
});

test('validateQuiz rejects invalid points', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
  ];
  q.points = 'triple'; // invalid
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(!result.ok);
});

test('validateQuiz accepts valid mc quiz', () => {
  const quiz = newQuiz();
  quiz.title = 'Test Quiz';
  quiz.author = 'Teacher';
  const q = newQuestion('mc');
  q.text = 'What is 2+2?';
  q.answers = [
    { text: '4', correct: true },
    { text: '5', correct: false },
  ];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(result.ok);
  assert(result.errors.length === 0);
});

test('validateQuiz accepts valid tf quiz', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('tf');
  q.text = 'True or false?';
  q.answers[0].correct = true;
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(result.ok);
});

test('validateQuiz accepts valid type-answer quiz', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('type');
  q.text = 'What is the answer?';
  q.accepted = ['answer', 'the answer'];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(result.ok);
});

test('validateQuiz accepts valid poll quiz', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('poll');
  q.text = 'Poll question';
  q.answers = [
    { text: 'Option 1', correct: false },
    { text: 'Option 2', correct: false },
  ];
  quiz.questions.push(q);
  const result = validateQuiz(quiz);
  assert(result.ok);
});

test('normalizeQuiz fills defaults', () => {
  const raw = {
    format: 'khawho-quiz',
    v: 1,
    id: 'abc',
    title: 'Test',
    author: 'Me',
    updated: '2024-01-01T00:00:00Z',
    questions: [],
  };
  const normalized = normalizeQuiz(raw);
  assert(normalized.format === 'khawho-quiz');
  assert(normalized.v === 1);
});

test('normalizeQuiz coerces invalid timeLimit to nearest valid', () => {
  const raw = {
    title: 'Test',
    questions: [
      {
        type: 'mc',
        text: 'Q',
        timeLimit: 25,
        answers: [{ text: 'A', correct: true }],
      },
    ],
  };
  const normalized = normalizeQuiz(raw);
  assert(ALLOWED_TIMES.includes(normalized.questions[0].timeLimit));
});

test('quizToJSON and quizFromJSON round-trip', () => {
  const original = newQuiz();
  original.title = 'Test';
  original.author = 'Me';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
  ];
  original.questions.push(q);

  const json = quizToJSON(original);
  assert(typeof json === 'string');
  const restored = quizFromJSON(json);
  assert(restored.title === original.title);
  assert(restored.author === original.author);
  assert(restored.questions.length === 1);
  assert(restored.questions[0].text === 'Question?');
});

test('quizToCSV creates CSV with headers', () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'What is 2+2?';
  q.answers = [
    { text: '4', correct: true },
    { text: '5', correct: false },
    { text: '6', correct: false },
  ];
  q.timeLimit = 30;
  quiz.questions.push(q);

  const csv = quizToCSV(quiz);
  assert(typeof csv === 'string');
  assert(csv.includes('type'));
  assert(csv.includes('question'));
  assert(csv.includes('What is 2+2?'));
  assert(csv.includes('30'));
});

test('quizFromCSV parses simple CSV', () => {
  const csv = `type,question,a1,a2,a3,a4,correct,time
mc,What is 2+2?,4,5,6,7,1,30`;

  const quiz = quizFromCSV(csv);
  assert(quiz.questions.length === 1);
  const q = quiz.questions[0];
  assert(q.type === 'mc');
  assert(q.text === 'What is 2+2?');
  assert(q.timeLimit === 30);
  assert(q.answers[0].correct === true);
  assert(q.answers[1].correct === false);
});

test('quizFromCSV handles quoted fields with commas', () => {
  const csv = `type,question,a1,a2,correct,time
mc,"What is 2+2, really?",4,5,1,30`;

  const quiz = quizFromCSV(csv);
  assert(quiz.questions.length === 1);
  assert(quiz.questions[0].text === 'What is 2+2, really?');
});

test('quizFromCSV handles quoted fields with newlines', () => {
  const csv = `type,question,a1,a2,correct,time
mc,"Question with
newline",4,5,1,30`;

  const quiz = quizFromCSV(csv);
  assert(quiz.questions.length === 1);
  assert(quiz.questions[0].text === 'Question with\nnewline');
});

test('quizFromCSV handles BOM', () => {
  const csvWithBOM = '﻿type,question,a1,a2,correct,time\nmc,Q,4,5,1,30';
  const quiz = quizFromCSV(csvWithBOM);
  assert(quiz.questions.length === 1);
});

test('quizFromCSV CSV round-trip', () => {
  const original = newQuiz();
  original.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
  ];
  original.questions.push(q);

  const csv = quizToCSV(original);
  const restored = quizFromCSV(csv);
  assert(restored.questions.length === 1);
  assert(restored.questions[0].text === 'Question?');
  assert(restored.questions[0].answers[0].text === 'A');
});

test('quizFromCSV handles True/False as type-answer', () => {
  const csv = `type,question,a1,a2,correct,time
mc,True or False?,True,False,1,30`;
  const quiz = quizFromCSV(csv);
  assert(quiz.questions[0].type === 'tf');
});

test('quizFromCSV handles type-answer with pipe-separated accepted', () => {
  const csv = `type,question,a1,a2,correct,time
type,Answer this,yes|yeah|yep,,1,30`;
  const quiz = quizFromCSV(csv);
  const q = quiz.questions[0];
  assert(q.type === 'type');
  assert(q.accepted.length === 3);
});

test('quizFromKahootRows finds header row with Question', () => {
  const rows = [
    ['Title', 'Description'],
    ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Time limit (sec)', 'Correct answer(s)'],
    ['What is 2+2?', '4', '5', '6', '7', '30', '1'],
  ];
  const quiz = quizFromKahootRows(rows);
  assert(quiz.questions.length === 1);
  assert(quiz.questions[0].text === 'What is 2+2?');
});

test('quizFromKahootRows maps columns correctly', () => {
  const rows = [
    ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Time limit (sec)', 'Correct answer(s)'],
    ['Q1?', 'A', 'B', 'C', 'D', '20', '2'],
  ];
  const quiz = quizFromKahootRows(rows);
  const q = quiz.questions[0];
  assert(q.type === 'mc');
  assert(q.answers[0].text === 'A');
  assert(q.answers[1].text === 'B');
  assert(q.answers[1].correct === true);
  assert(q.timeLimit === 20);
});

test('quizFromKahootRows handles multiple correct answers', () => {
  const rows = [
    ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Time limit (sec)', 'Correct answer(s)'],
    ['Q1?', 'A', 'B', 'C', 'D', '20', '1,3'],
  ];
  const quiz = quizFromKahootRows(rows);
  const q = quiz.questions[0];
  assert(q.answers[0].correct === true);
  assert(q.answers[1].correct === false);
  assert(q.answers[2].correct === true);
  assert(q.answers[3].correct === false);
});

test('quizFromKahootRows treats 2-answer True/False as tf', () => {
  const rows = [
    ['Question', 'Answer 1', 'Answer 2', 'Time limit (sec)', 'Correct answer(s)'],
    ['Statement?', 'True', 'False', '30', '1'],
  ];
  const quiz = quizFromKahootRows(rows);
  const q = quiz.questions[0];
  assert(q.type === 'tf');
});

test('checkTypeAnswer normalizes and matches', () => {
  const q = newQuestion('type');
  q.accepted = ['answer', 'the answer'];
  assert(checkTypeAnswer(q, 'answer') === true);
  assert(checkTypeAnswer(q, 'ANSWER') === true);
  assert(checkTypeAnswer(q, '  answer  ') === true);
  assert(checkTypeAnswer(q, 'the   answer') === true);
  assert(checkTypeAnswer(q, 'wrong') === false);
});

test('checkTypeAnswer handles edge cases', () => {
  const q = newQuestion('type');
  q.accepted = ['42', 'forty-two'];
  assert(checkTypeAnswer(q, '42') === true);
  assert(checkTypeAnswer(q, '  42  ') === true);
  assert(checkTypeAnswer(q, 'forty-two') === true);
  assert(checkTypeAnswer(q, '40') === false);
});
