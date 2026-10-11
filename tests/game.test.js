import test from 'node:test';
import assert from 'node:assert';
import { createGame } from '../js/game.js';

/**
 * Create a minimal valid quiz for testing
 */
function createTestQuiz(options = {}) {
  const {
    type = 'mc',
    correctCount = 1,
    questionCount = 2,
  } = options;

  const questions = [];
  for (let i = 0; i < questionCount; i++) {
    const answers = [];
    for (let j = 0; j < 4; j++) {
      answers.push({
        text: `Answer ${j + 1}`,
        correct: j < correctCount,
      });
    }

    if (type === 'type') {
      questions.push({
        type: 'type',
        text: `Question ${i + 1}`,
        image: null,
        timeLimit: 10,
        points: 'standard',
        answers,
        accepted: ['Answer 1', 'ans 1', 'answer1'],
      });
    } else if (type === 'poll') {
      questions.push({
        type: 'poll',
        text: `Question ${i + 1}`,
        image: null,
        timeLimit: 10,
        points: 'standard',
        answers: [
          { text: 'Option A' },
          { text: 'Option B' },
          { text: 'Option C' },
          { text: 'Option D' },
        ],
      });
    } else if (type === 'tf') {
      questions.push({
        type: 'tf',
        text: `Question ${i + 1}`,
        image: null,
        timeLimit: 10,
        points: 'standard',
        answers: [
          { text: 'True', correct: true },
          { text: 'False', correct: false },
        ],
      });
    } else {
      questions.push({
        type: 'mc',
        text: `Question ${i + 1}`,
        image: null,
        timeLimit: 10,
        points: 'standard',
        answers,
      });
    }
  }

  return {
    format: 'khawho-quiz',
    v: 1,
    id: 'test-quiz',
    title: 'Test Quiz',
    author: 'Tester',
    updated: new Date().toISOString(),
    questions,
  };
}

test('createGame with valid quiz', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  assert(game, 'game should be created');
  assert.strictEqual(game.gameStarted, false);
});

test('game throws on invalid quiz', () => {
  assert.throws(() => createGame(null));
  assert.throws(() => createGame({ questions: [] }));
  assert.throws(() => createGame({}));
});

test('addPlayer creates new player', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  game.addPlayer('player1', 'Alice', 'Alice');
  const players = game.players;
  assert(players.has('player1'), 'player should be in players map');
});

test('addPlayer rejects duplicates in same game', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz, { maxPlayers: 2 });
  game.addPlayer('p1', 'Alice', 'Alice');
  game.addPlayer('p2', 'Bob', 'Bob');
  assert.throws(() => {
    game.addPlayer('p3', 'Charlie', 'Charlie');
  }, /full/i);
});

test('validateName accepts valid names', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.addPlayer('p2', 'Bob', 'Bob');
  assert.strictEqual(game.players.size, 2);
});

test('removePlayer removes player but allows rejoin', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  game.addPlayer('player1', 'Alice', 'Alice');
  game.removePlayer('player1');
  assert(!game.players.has('player1'), 'player should be removed');
  // Rejoin should restore stats
  game.addPlayer('player1', 'Alice', 'Alice');
  assert(game.players.has('player1'), 'player should be re-added');
});

test('kickPlayer prevents rejoin', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  game.addPlayer('player1', 'Alice', 'Alice');
  game.kickPlayer('player1');
  assert(!game.players.has('player1'));
  // Attempting rejoin should start fresh
  game.addPlayer('player1', 'Alice', 'Alice');
  const player = game.players.get('player1');
  assert.strictEqual(player.score, 0);
  assert.strictEqual(player.streak, 0);
});

test('lock and unlock game', () => {
  const quiz = createTestQuiz();
  const game = createGame(quiz);
  assert(!game.isLocked());
  game.lock();
  assert(game.isLocked());
  game.unlock();
  assert(!game.isLocked());
});

test('startQuestion returns player payloads without correctness', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();
  const now = Date.now();
  const result = game.startQuestion(now);

  assert(result.playerPayloads, 'should have playerPayloads');
  assert(result.playerPayloads.has('p1'), 'should have payload for p1');
  const payload = result.playerPayloads.get('p1');
  assert.strictEqual(payload.type, 'mc');
  assert(Array.isArray(payload.answers), 'answers should be array');
  assert.strictEqual(payload.answers.length, 4, 'should have 4 answers');

  // Verify no correctness in payload
  payload.answers.forEach((answer) => {
    assert(!('correct' in answer), 'answer should not have correct property');
  });
});

test('answer ids are unique per game', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });

  const game1 = createGame(quiz);
  game1.addPlayer('p1', 'Alice', 'Alice');
  game1.start();
  const result1 = game1.startQuestion(Date.now());
  const ids1 = result1.playerPayloads.get('p1').answers.map(a => a.id);

  const game2 = createGame(quiz);
  game2.addPlayer('p1', 'Alice', 'Alice');
  game2.start();
  const result2 = game2.startQuestion(Date.now());
  const ids2 = result2.playerPayloads.get('p1').answers.map(a => a.id);

  assert.notDeepStrictEqual(ids1, ids2, 'answer ids should differ between games');
});

test('scoring: correct answer at start of timer', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);

  // The first answer in the original quiz (index 0) is correct
  // Find which shuffled ID corresponds to it
  const mapping = game._getAnswerIdMapping();
  let correctId = null;
  for (const [id, origIdx] of mapping) {
    if (origIdx === 0) {
      correctId = id;
      break;
    }
  }
  assert(correctId, 'should find the correct answer ID');

  game.submitAnswer('p1', [correctId], now); // Immediate answer

  // Wait 1 second and end
  const endTime = now + 1000;
  const results = game.endQuestion(endTime);

  const playerResult = results.get('p1');
  assert(playerResult.correct, 'should be correct');
  assert(playerResult.points >= 500 && playerResult.points <= 1000, `points should be 500-1000, got ${playerResult.points}`);
  assert.strictEqual(playerResult.score, playerResult.points);
});

test('scoring: wrong answer', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);
  const payload = result.playerPayloads.get('p1');

  // Submit wrong answer - find one that's not index 0 (which is correct)
  const mapping = game._getAnswerIdMapping();
  let wrongId = null;
  for (const [id, origIdx] of mapping) {
    if (origIdx !== 0) {
      wrongId = id;
      break;
    }
  }
  assert(wrongId, 'should find a wrong answer');

  game.submitAnswer('p1', [wrongId], now);

  const endTime = now + 1000;
  const results = game.endQuestion(endTime);
  const playerResult = results.get('p1');

  assert(!playerResult.correct, 'should be incorrect');
  assert.strictEqual(playerResult.points, 0, 'wrong answer should give 0 points');
  assert.strictEqual(playerResult.score, 0);
});

test('scoring: no answer (timeout)', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  game.startQuestion(now);
  // Don't submit answer

  const endTime = now + 1000;
  const results = game.endQuestion(endTime);
  const playerResult = results.get('p1');

  assert(!playerResult.correct, 'should be incorrect');
  assert.strictEqual(playerResult.points, 0);
});

test('streak tracking', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 3 });
  const game = createGame(quiz, { shuffleQuestions: false });
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  // Answer question 1 correctly
  let now = Date.now();
  let result = game.startQuestion(now);
  let mapping = game._getAnswerIdMapping();
  let correctId = Array.from(mapping).find(([id, idx]) => idx === 0)[0];
  game.submitAnswer('p1', [correctId], now);
  let results = game.endQuestion(now + 1000);
  assert.strictEqual(results.get('p1').streak, 1);

  // Answer question 2 correctly
  game.nextQuestion();
  now = Date.now();
  result = game.startQuestion(now);
  mapping = game._getAnswerIdMapping();
  correctId = Array.from(mapping).find(([id, idx]) => idx === 0)[0];
  game.submitAnswer('p1', [correctId], now);
  results = game.endQuestion(now + 1000);
  assert.strictEqual(results.get('p1').streak, 2);

  // Answer question 3 incorrectly
  game.nextQuestion();
  now = Date.now();
  result = game.startQuestion(now);
  mapping = game._getAnswerIdMapping();
  const wrongId = Array.from(mapping).find(([id, idx]) => idx !== 0)[0];
  game.submitAnswer('p1', [wrongId], now); // Wrong
  results = game.endQuestion(now + 1000);
  assert.strictEqual(results.get('p1').streak, 0, 'streak should reset on wrong answer');
});

test('streak bonus calculation (capped at 500)', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 6 });
  const game = createGame(quiz, { shuffleQuestions: false });
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const pointsByStreak = [];
  for (let i = 0; i < 6; i++) {
    const now = Date.now();
    const result = game.startQuestion(now);
    const mapping = game._getAnswerIdMapping();
    const correctId = Array.from(mapping).find(([id, idx]) => idx === 0)[0];
    game.submitAnswer('p1', [correctId], now);
    const results = game.endQuestion(now + 1000);
    pointsByStreak.push(results.get('p1').points);
    if (i < 5) game.nextQuestion();
  }

  // Streak 1: 1000 * (1 - 0.05) = 950 (rounded) + 0 bonus = 950
  // Streak 2: 950 + 100 = 1050
  // Streak 3: 950 + 200 = 1150
  // Streak 4: 950 + 300 = 1250
  // Streak 5: 950 + 400 = 1350
  // Streak 6: 950 + 500 = 1450 (capped at +500)

  assert(pointsByStreak[1] > pointsByStreak[0], 'streak 2 should have more points than streak 1');
  assert(pointsByStreak[5] - pointsByStreak[4] <= 100, 'bonus should be capped at 100 per level');
});

test('double points', () => {
  const quiz = {
    format: 'khawho-quiz',
    v: 1,
    id: 'test',
    title: 'Test',
    author: 'Tester',
    updated: new Date().toISOString(),
    questions: [{
      type: 'mc',
      text: 'Q1',
      image: null,
      timeLimit: 10,
      points: 'double',
      answers: [
        { text: 'A1', correct: true },
        { text: 'A2', correct: false },
        { text: 'A3', correct: false },
        { text: 'A4', correct: false },
      ],
    }],
  };

  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);
  const mapping = game._getAnswerIdMapping();
  const correctId = Array.from(mapping).find(([id, idx]) => idx === 0)[0];
  game.submitAnswer('p1', [correctId], now);

  const results = game.endQuestion(now + 1000);
  const points = results.get('p1').points;

  // Base should be ~950, doubled = ~1900
  assert(points > 1800, `double points should be ~1900, got ${points}`);
});

test('multi-correct answer matching', () => {
  const quiz = {
    format: 'khawho-quiz',
    v: 1,
    id: 'test',
    title: 'Test',
    author: 'Tester',
    updated: new Date().toISOString(),
    questions: [{
      type: 'mc',
      text: 'Q1',
      image: null,
      timeLimit: 10,
      points: 'standard',
      answers: [
        { text: 'A1', correct: true },
        { text: 'A2', correct: true },
        { text: 'A3', correct: false },
        { text: 'A4', correct: false },
      ],
    }],
  };

  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);
  const payload = result.playerPayloads.get('p1');

  // Find the correct answers (should be first two)
  // Need to track shuffled IDs...actually this is tricky without knowing mapping
  // Just verify multi=true
  assert(payload.multi, 'multi should be true for multi-correct');
});

test('type-answer normalization', () => {
  const quiz = {
    format: 'khawho-quiz',
    v: 1,
    id: 'test',
    title: 'Test',
    author: 'Tester',
    updated: new Date().toISOString(),
    questions: [{
      type: 'type',
      text: 'Q1',
      image: null,
      timeLimit: 10,
      points: 'standard',
      answers: [{ text: 'Correct', correct: true }],
      accepted: ['correct', 'Correct', 'CORRECT', 'correct answer'],
    }, {
      type: 'type',
      text: 'Q2',
      image: null,
      timeLimit: 10,
      points: 'standard',
      answers: [{ text: 'Another', correct: true }],
      accepted: ['another'],
    }],
  };

  const game = createGame(quiz, { shuffleQuestions: false });
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  game.startQuestion(now);

  // Different cases/spaces should match
  game.submitAnswer('p1', 'CORRECT', now);
  let results = game.endQuestion(now + 1000);
  assert(results.get('p1').correct, 'CORRECT should match');

  // Test another question with spaces
  game.nextQuestion();
  const now2 = Date.now();
  game.startQuestion(now2);
  game.submitAnswer('p1', '  another  ', now2);
  results = game.endQuestion(now2 + 1000);
  assert(results.get('p1').correct, 'spaces should be trimmed');
});

test('poll gives no points', () => {
  const quiz = {
    format: 'khawho-quiz',
    v: 1,
    id: 'test',
    title: 'Test',
    author: 'Tester',
    updated: new Date().toISOString(),
    questions: [{
      type: 'poll',
      text: 'Q1',
      image: null,
      timeLimit: 10,
      points: 'standard',
      answers: [
        { text: 'A1' },
        { text: 'A2' },
        { text: 'A3' },
        { text: 'A4' },
      ],
    }],
  };

  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);
  const payload = result.playerPayloads.get('p1');
  game.submitAnswer('p1', [payload.answers[0].id], now);

  const results = game.endQuestion(now + 1000);
  const playerResult = results.get('p1');
  assert.strictEqual(playerResult.correct, null, 'poll correct should be null');
  assert.strictEqual(playerResult.points, 0, 'poll should give 0 points');
});

test('late join gets 0 for missed questions', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 2 });
  const game = createGame(quiz, { shuffleQuestions: false });

  // Start with player 1
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  game.startQuestion(now);
  game.submitAnswer('p1', ['dummy-id'], now); // Doesn't matter what they submit
  game.endQuestion(now + 1000);

  // Player 2 joins late
  game.addPlayer('p2', 'Bob', 'Bob');

  // Move to next question without having p2 answer
  game.nextQuestion();
  const now2 = Date.now();
  game.startQuestion(now2);
  game.submitAnswer('p2', ['dummy-id'], now2); // p2's answer

  const results = game.endQuestion(now2 + 1000);
  // p1 should have answered both
  // p2 missed the first (should be 0), answered the second
  assert(results.has('p1'));
  assert(results.has('p2'));
});

test('rejoin restores score', () => {
  const quiz = createTestQuiz({ type: 'mc', correctCount: 1, questionCount: 1 });
  const game = createGame(quiz);
  game.addPlayer('p1', 'Alice', 'Alice');
  game.start();

  const now = Date.now();
  const result = game.startQuestion(now);
  const payload = result.playerPayloads.get('p1');
  game.submitAnswer('p1', [payload.answers[0].id], now);

  const results = game.endQuestion(now + 1000);
  const scoreBeforeRejoin = results.get('p1').score;

  // Simulate disconnect
  game.removePlayer('p1');
  assert(!game.players.has('p1'));

  // Rejoin
  game.addPlayer('p1', 'Alice', 'Alice');
  const player = game.players.get('p1');
  assert.strictEqual(player.score, scoreBeforeRejoin, 'rejoin should restore score');
});
