import test from 'node:test';
import assert from 'node:assert';
import { createGame } from '../js/game.js';

const quiz = () => ({
  format: 'khawho-quiz', v: 1, id: 'q', title: 'T', author: 'A', updated: 'x',
  questions: [
    { type: 'mc', text: 'Q1', image: null, timeLimit: 20, points: 'standard',
      answers: [{ text: 'a', correct: true }, { text: 'b', correct: false }, { text: 'c', correct: false }, { text: 'd', correct: false }] },
    { type: 'poll', text: 'Q2', image: null, timeLimit: 10, points: 'standard',
      answers: [{ text: 'x' }, { text: 'y' }] },
    { type: 'type', text: 'Q3', image: null, timeLimit: 10, points: 'standard', answers: [], accepted: ['Yes'] },
  ],
});

function idFor(game, payload, origText) {
  return payload.answers.find(a => a.text === origText).id;
}

test('score uses each player\'s own answer time, not question end time', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('fast', 'Fast'); g.addPlayer('slow', 'Slow');
  g.start();
  const t0 = 1_000_000;
  const { playerPayloads } = g.startQuestion(t0);
  g.submitAnswer('fast', [idFor(g, playerPayloads.get('fast'), 'a')], t0);
  g.submitAnswer('slow', [idFor(g, playerPayloads.get('slow'), 'a')], t0 + 20000);
  const r = g.endQuestion(t0 + 20000);
  assert.strictEqual(r.get('fast').points, 1000);
  assert.strictEqual(r.get('slow').points, 500);
  assert.strictEqual(r.get('fast').rank, 1);
  assert.strictEqual(r.get('slow').rank, 2);
});

test('paused time is excluded from scoring and answers are refused while paused', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('p', 'P'); g.start();
  const t0 = 5_000_000;
  const { playerPayloads } = g.startQuestion(t0);
  g.pause(t0 + 2000);
  assert.strictEqual(g.submitAnswer('p', [idFor(g, playerPayloads.get('p'), 'a')], t0 + 3000), false);
  g.resume(t0 + 12000); // 10s paused
  assert.strictEqual(g.elapsedAt(t0 + 12000), 2000);
  g.submitAnswer('p', [idFor(g, playerPayloads.get('p'), 'a')], t0 + 14000); // 4s effective
  const r = g.endQuestion(t0 + 14000);
  assert.strictEqual(r.get('p').points, Math.round(1000 * (1 - (4000 / 20000) / 2)));
});

test('reveal always lists the player\'s own correct ids; payload never has correctness', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('p', 'P'); g.start();
  const { playerPayloads } = g.startQuestion(0);
  const payload = playerPayloads.get('p');
  assert.ok(!JSON.stringify(payload).match(/correct|accepted/i));
  g.submitAnswer('p', [idFor(g, payload, 'b')], 100); // wrong
  const r = g.endQuestion(200).get('p');
  assert.strictEqual(r.correct, false);
  assert.deepStrictEqual(r.correctIds, [idFor(g, payload, 'a')]);
  assert.deepStrictEqual(r.correctText, ['a']);
});

test('shape/color pairs stay together and cover all four; per-player mode differs between players', () => {
  const g = createGame(quiz(), { shuffleQuestions: false, perPlayerOrder: true });
  for (let i = 0; i < 12; i++) g.addPlayer('p' + i, 'P' + i);
  g.start();
  const { playerPayloads, hostView } = g.startQuestion(0);
  const orders = new Set();
  playerPayloads.forEach(p => {
    assert.strictEqual(new Set(p.answers.map(a => a.shape)).size, 4);
    const pairing = { triangle: 'red', diamond: 'blue', circle: 'yellow', square: 'green' };
    p.answers.forEach(a => assert.strictEqual(pairing[a.shape], a.color));
    orders.add(p.answers.map(a => a.text).join(''));
  });
  assert.ok(orders.size > 1, 'players should get different orders');
  assert.ok(hostView.perPlayer);
  hostView.tiles.forEach(t => assert.strictEqual(t.color, null));
});

test('late joiner is not scored for the open question; leaver keeps score in final results', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('a', 'A'); g.start();
  const { playerPayloads } = g.startQuestion(0);
  g.addPlayer('late', 'Late');
  g.submitAnswer('a', [idFor(g, playerPayloads.get('a'), 'a')], 10);
  const r = g.endQuestion(20);
  assert.ok(!r.has('late'));
  g.removePlayer('a');
  const fin = g.getFinalResults().leaderboard;
  assert.strictEqual(fin[0].name, 'A');
  assert.ok(fin[0].score > 0);
  assert.strictEqual(fin.length, 2);
});

test('CSV has per-question answer/correct/points and quotes safely', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('p', 'Pat, "Jr"'); g.addPlayer('q', 'Quinn'); g.start();
  let { playerPayloads } = g.startQuestion(0);
  g.submitAnswer('p', [idFor(g, playerPayloads.get('p'), 'a')], 0);
  g.submitAnswer('q', [idFor(g, playerPayloads.get('q'), 'c')], 0);
  g.endQuestion(1);
  g.nextQuestion();
  ({ playerPayloads } = g.startQuestion(2));
  g.submitAnswer('p', [playerPayloads.get('p').answers[0].id], 2);
  g.endQuestion(3);
  g.nextQuestion();
  g.startQuestion(4);
  g.submitAnswer('p', '=HYPERLINK("x")', 5);
  g.submitAnswer('q', ' yes ', 5);
  g.endQuestion(6);
  const lines = g.getResultsCSV().split('\r\n');
  assert.strictEqual(lines[0], 'Player,Rank,Score,Q1 answer,Q1 correct,Q1 points,Q2 answer,Q2 correct,Q2 points,Q3 answer,Q3 correct,Q3 points');
  assert.ok(lines[1].startsWith('Quinn,') || lines[1].startsWith('"Pat'));
  const pat = lines.find(l => l.startsWith('"Pat, ""Jr"""'));
  assert.ok(pat.includes(',a,yes,'));
  assert.ok(pat.includes(`,"'=HYPERLINK(""x"")"`));
  const quinn = lines.find(l => l.startsWith('Quinn'));
  assert.ok(quinn.includes(',c,no,0,'));
  assert.ok(quinn.includes(',yes,yes,'));
});

test('per-question stats: percent correct, poll has none', () => {
  const g = createGame(quiz(), { shuffleQuestions: false });
  g.addPlayer('p', 'P'); g.addPlayer('q', 'Q'); g.start();
  const { playerPayloads } = g.startQuestion(0);
  g.submitAnswer('p', [idFor(g, playerPayloads.get('p'), 'a')], 0);
  g.endQuestion(1);
  g.nextQuestion(); g.startQuestion(2); g.endQuestion(3);
  const s = g.getQuestionStats();
  assert.strictEqual(s[0].pct, 50);
  assert.strictEqual(s[1].pct, null);
});
