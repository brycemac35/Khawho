/**
 * Pure game engine (no DOM, no network; Node-testable)
 * Host-authoritative state machine for Khawho quiz gameplay.
 *
 * Randomness: every question gets a fresh answer order and a fresh assignment
 * of the four shape/color pairs to screen positions (both from js/rng.js).
 * In perPlayerOrder mode each player gets their own order and own pairing.
 * Answer ids sent to players are random per player per question, so nothing a
 * player receives reveals which answer is correct.
 */

import { shuffle, randomId } from './rng.js';

const PAIRS = [
  { shape: 'triangle', color: 'red' },
  { shape: 'diamond', color: 'blue' },
  { shape: 'circle', color: 'yellow' },
  { shape: 'square', color: 'green' },
];

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function normalizeText(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Guard against spreadsheet formula injection in student-typed text. */
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Competition ranking (ties share a rank) for a list sorted by score desc. */
function withRanks(sorted) {
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}

/**
 * Create a game state machine
 * @param {object} quiz - Quiz object with questions array
 * @param {object} settings - {shuffleQuestions, perPlayerOrder, randomNamesOnly, maxPlayers}
 */
export function createGame(quiz, settings = {}) {
  const {
    shuffleQuestions = true,
    perPlayerOrder = false,
    maxPlayers = 60,
  } = settings;

  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new Error('Invalid quiz: must have questions array');
  }

  const questionOrder = shuffleQuestions
    ? shuffle(range(quiz.questions.length))
    : range(quiz.questions.length);

  // Active players (connected or lobby) and players who dropped out mid-game
  // (kept so scores, rejoin, results and CSV stay complete).
  const players = new Map(); // clientId -> record
  const departed = new Map(); // clientId -> record
  const playerNames = new Map();

  let currentQuestionIndex = -1;
  let gameStarted = false;
  let gameLocked = false;

  // Per-question state
  let questionOpen = false;
  let questionStartTime = null;
  let pausedTotal = 0;
  let pauseStartedAt = null;
  let activeIds = new Set(); // players who received this question
  let answers = new Map(); // clientId -> { answer, elapsed }
  let idMaps = new Map(); // clientId -> Map(answerId -> original answer index)
  let payloads = new Map(); // clientId -> player payload (for resend on rejoin)
  let lastResults = new Map();
  let lastSummary = null;
  let currentHostView = null;

  const questionStats = []; // per play position

  function newRecord(name, displayName) {
    return { name, displayName: displayName || name, score: 0, streak: 0, history: [] };
  }

  function addPlayer(clientId, name, displayName) {
    if (!players.has(clientId) && players.size >= maxPlayers) {
      throw new Error(`Game full (max ${maxPlayers} players)`);
    }
    let record = players.get(clientId) || departed.get(clientId);
    departed.delete(clientId);
    if (record) {
      record.name = name;
      record.displayName = displayName || name;
    } else {
      record = newRecord(name, displayName);
    }
    players.set(clientId, record);
    playerNames.set(clientId, record.displayName);
    return record;
  }

  function removePlayer(clientId) {
    const record = players.get(clientId);
    if (!record) return;
    players.delete(clientId);
    playerNames.delete(clientId);
    // Before the game starts a leaver simply disappears; after, keep the record.
    if (gameStarted) departed.set(clientId, record);
  }

  function kickPlayer(clientId) {
    players.delete(clientId);
    departed.delete(clientId);
    playerNames.delete(clientId);
    activeIds.delete(clientId);
    answers.delete(clientId);
  }

  const lock = () => { gameLocked = true; };
  const unlock = () => { gameLocked = false; };
  const isLocked = () => gameLocked;

  function start() {
    gameStarted = true;
    currentQuestionIndex = 0;
  }

  // ---- timing (pause aware) ----
  function elapsedAt(now) {
    const pausedNow = pauseStartedAt !== null ? now - pauseStartedAt : 0;
    return Math.max(0, now - questionStartTime - pausedTotal - pausedNow);
  }

  function pause(now) {
    if (!questionOpen || pauseStartedAt !== null) return false;
    pauseStartedAt = now;
    return true;
  }

  function resume(now) {
    if (pauseStartedAt === null) return false;
    pausedTotal += Math.max(0, now - pauseStartedAt);
    pauseStartedAt = null;
    return true;
  }

  const isPaused = () => pauseStartedAt !== null;

  function currentQuestion() {
    return quiz.questions[questionOrder[currentQuestionIndex]];
  }

  // ---- question lifecycle ----
  function startQuestion(now) {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= questionOrder.length) {
      throw new Error('Invalid question index');
    }

    const q = currentQuestion();
    const total = questionOrder.length;
    questionOpen = true;
    questionStartTime = now;
    pausedTotal = 0;
    pauseStartedAt = null;
    answers = new Map();
    idMaps = new Map();
    payloads = new Map();
    activeIds = new Set(players.keys());

    const graded = q.type === 'mc' || q.type === 'tf';
    const multi = graded && q.answers.filter(a => a.correct).length > 1;
    const n = q.answers.length;

    // Shared order + shared position->pair assignment (used unless perPlayerOrder)
    const sharedOrder = shuffle(range(n));
    const sharedPairs = shuffle(PAIRS);

    players.forEach((_, clientId) => {
      const base = {
        qIndex: currentQuestionIndex,
        total,
        type: q.type,
        text: q.text,
        image: q.image || null,
        timeLimit: q.timeLimit,
        multi,
      };
      if (q.type === 'type') {
        payloads.set(clientId, { ...base, answers: [] });
        return;
      }
      const order = perPlayerOrder ? shuffle(range(n)) : sharedOrder;
      const pairs = perPlayerOrder ? shuffle(PAIRS) : sharedPairs;
      const ids = new Map();
      const tiles = order.map((origIdx, pos) => {
        const id = randomId(4);
        ids.set(id, origIdx);
        return { id, text: q.answers[origIdx].text, shape: pairs[pos].shape, color: pairs[pos].color };
      });
      idMaps.set(clientId, ids);
      payloads.set(clientId, { ...base, answers: tiles });
    });

    // Host view. Shared mode: tiles in the common on-screen order with
    // shape/color. Per-player mode: plain text list, no colors/shapes.
    let tiles;
    if (q.type === 'type') {
      tiles = [];
    } else if (perPlayerOrder) {
      tiles = q.answers.map((a, i) => ({ index: i, text: a.text, shape: null, color: null, correct: !!a.correct }));
    } else {
      tiles = sharedOrder.map((origIdx, pos) => ({
        index: origIdx,
        text: q.answers[origIdx].text,
        shape: sharedPairs[pos].shape,
        color: sharedPairs[pos].color,
        correct: !!q.answers[origIdx].correct,
      }));
    }

    currentHostView = {
      qIndex: currentQuestionIndex,
      total,
      type: q.type,
      text: q.text,
      image: q.image || null,
      timeLimit: q.timeLimit,
      perPlayer: perPlayerOrder,
      tiles,
      accepted: q.type === 'type' ? [...(q.accepted || [])] : null,
      answers: q.type === 'type'
        ? q.answers.map(a => ({ text: a.text, correct: a.correct }))
        : q.answers.map(a => ({ text: a.text, correct: q.type === 'poll' ? undefined : a.correct })),
      playerCount: players.size,
    };

    return { hostView: currentHostView, playerPayloads: payloads };
  }

  /** The payload a (re)joining player should see for the open question, or null. */
  function getPlayerPayload(clientId) {
    if (!questionOpen || !activeIds.has(clientId)) return null;
    return payloads.get(clientId) || null;
  }

  function hasAnswered(clientId) {
    return answers.has(clientId);
  }

  function submitAnswer(clientId, answer, now) {
    if (!players.has(clientId)) throw new Error(`Player ${clientId} not found`);
    if (!questionOpen || pauseStartedAt !== null) return false;
    if (!activeIds.has(clientId)) return false;
    if (answers.has(clientId)) return false;
    answers.set(clientId, { answer, elapsed: elapsedAt(now) });
    return true;
  }

  function isQuestionDone(now) {
    if (!questionOpen) return true;
    const q = currentQuestion();
    if (elapsedAt(now) >= q.timeLimit * 1000) return true;
    let waiting = 0;
    activeIds.forEach(id => {
      if (players.has(id) && !answers.has(id)) waiting++;
    });
    return waiting === 0 && [...activeIds].some(id => players.has(id));
  }

  function answeredCount() {
    let c = 0;
    activeIds.forEach(id => { if (answers.has(id)) c++; });
    return c;
  }

  function endQuestion(now) {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= questionOrder.length) {
      throw new Error('No active question');
    }
    if (!questionOpen) return lastResults;
    if (pauseStartedAt !== null) resume(now);
    questionOpen = false;

    const q = currentQuestion();
    const timeMs = q.timeLimit * 1000;
    const correctIndices = [];
    q.answers.forEach((a, i) => { if (a.correct) correctIndices.push(i); });
    const graded = q.type === 'mc' || q.type === 'tf';

    const counts = q.answers.map(() => 0);
    let correctCount = 0;
    let answered = 0;
    let present = 0;
    const typed = new Map();

    // Pass 1: grade and score everybody who was in the game for this question.
    const rows = []; // { clientId, record, result }
    activeIds.forEach(clientId => {
      const record = players.get(clientId) || departed.get(clientId);
      if (!record) return; // kicked
      present++;
      const given = answers.get(clientId);
      const ids = idMaps.get(clientId);
      let correct = null;
      let points = 0;
      let answerText = '';
      let chosen = [];

      if (given !== undefined) {
        answered++;
        if (q.type === 'type') {
          answerText = String(given.answer ?? '').slice(0, 200);
          const n = normalizeText(answerText);
          correct = (q.accepted || []).some(a => normalizeText(a) === n);
          if (n) typed.set(n, (typed.get(n) || 0) + 1);
        } else {
          const submitted = Array.isArray(given.answer) ? given.answer : [];
          chosen = [...new Set(submitted
            .map(id => ids?.get(id))
            .filter(i => i !== undefined))].sort((a, b) => a - b);
          chosen.forEach(i => { counts[i]++; });
          answerText = chosen.map(i => q.answers[i].text).join(' | ');
          if (graded) {
            correct = chosen.length === correctIndices.length
              && chosen.every((v, j) => v === correctIndices[j]);
          }
        }
      } else if (q.type !== 'poll') {
        correct = false;
      }

      if (correct === true) {
        const frac = Math.min(1, given.elapsed / timeMs);
        points = Math.round(1000 * (1 - frac / 2));
        if (q.points === 'double') points *= 2;
        else if (q.points === 'none') points = 0;
        record.streak += 1;
        if (record.streak > 1 && q.points !== 'none') {
          points += Math.min(500, (record.streak - 1) * 100);
        }
        correctCount++;
      } else if (correct === false) {
        record.streak = 0;
      }

      record.score += points;
      record.history[currentQuestionIndex] = { answerText, correct, points };
      rows.push({ clientId, record, correct, points });
    });

    // Pass 2: ranks once all scores are final.
    const everyone = [...players.values(), ...departed.values()].sort((a, b) => b.score - a.score);
    const rankOf = new Map();
    let rank = 0;
    everyone.forEach((p, i) => {
      if (i === 0 || p.score !== everyone[i - 1].score) rank = i + 1;
      rankOf.set(p, rank);
    });

    const results = new Map();
    rows.forEach(({ clientId, record, correct, points }) => {
      const ids = idMaps.get(clientId);
      const correctIds = graded && ids
        ? [...ids].filter(([, idx]) => correctIndices.includes(idx)).map(([id]) => id)
        : [];
      const correctText = graded
        ? correctIndices.map(i => q.answers[i].text)
        : q.type === 'type' ? [...(q.accepted || [])].slice(0, 1) : [];
      results.set(clientId, {
        correct,
        points,
        score: record.score,
        streak: record.streak,
        rank: rankOf.get(record),
        correctIds,
        correctText,
      });
    });

    lastResults = results;
    lastSummary = {
      qIndex: currentQuestionIndex,
      type: q.type,
      text: q.text,
      present,
      answered,
      correctCount,
      counts: q.answers.map((a, i) => {
        const tile = currentHostView.tiles.find(t => t.index === i);
        return {
          text: a.text,
          count: counts[i],
          correct: graded ? !!a.correct : null,
          shape: tile ? tile.shape : null,
          color: tile ? tile.color : null,
        };
      }),
      typed: q.type === 'type'
        ? [...typed].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 8)
        : null,
      accepted: q.type === 'type' ? [...(q.accepted || [])] : null,
    };
    questionStats[currentQuestionIndex] = {
      pos: currentQuestionIndex,
      text: q.text,
      type: q.type,
      present,
      answered,
      correct: correctCount,
      pct: q.type === 'poll' || present === 0 ? null : Math.round((correctCount / present) * 100),
    };
    return results;
  }

  const getQuestionSummary = () => lastSummary;
  const getQuestionStats = () => questionStats.filter(Boolean);

  function nextQuestion() {
    currentQuestionIndex++;
  }

  function isGameOver() {
    return currentQuestionIndex >= questionOrder.length;
  }

  function allRecords() {
    return [...players.values(), ...departed.values()].sort((a, b) => b.score - a.score);
  }

  function getLeaderboard() {
    return withRanks(allRecords().map(p => ({ name: p.displayName, score: p.score, streak: p.streak })));
  }

  function getFinalResults() {
    return {
      leaderboard: withRanks(allRecords().map(p => ({ name: p.displayName, score: p.score }))),
      totalQuestions: questionOrder.length,
    };
  }

  /** Final {rank, score} for one player (used for the 'end' message). */
  function getPlayerFinal(clientId) {
    const record = players.get(clientId) || departed.get(clientId);
    if (!record) return null;
    const rank = withRanks(allRecords()).find(p => p.score === record.score).rank;
    return { rank, score: record.score };
  }

  /** CSV: player, rank, score, then per question: answer text, correct, points. */
  function getResultsCSV() {
    const ranked = withRanks(allRecords().map(p => ({ ...p })));
    const header = ['Player', 'Rank', 'Score'];
    for (let i = 0; i < questionOrder.length; i++) {
      header.push(`Q${i + 1} answer`, `Q${i + 1} correct`, `Q${i + 1} points`);
    }
    const lines = [header.map(csvCell).join(',')];
    ranked.forEach(p => {
      const row = [p.displayName, p.rank, p.score];
      for (let i = 0; i < questionOrder.length; i++) {
        const h = p.history[i];
        if (!h) row.push('', '–', 0);
        else row.push(h.answerText, h.correct === true ? 'yes' : h.correct === false ? 'no' : '–', h.points);
      }
      lines.push(row.map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }

  function getAnswerIdMapping() {
    const mapping = new Map();
    idMaps.forEach(ids => ids.forEach((idx, id) => mapping.set(id, idx)));
    return mapping;
  }

  return {
    get gameStarted() { return gameStarted; },
    get currentQuestionIndex() { return currentQuestionIndex; },
    get questionOrder() { return [...questionOrder]; },
    get players() { return new Map(players); },
    get playerNames() { return new Map(playerNames); },
    get perPlayerOrder() { return perPlayerOrder; },

    addPlayer,
    removePlayer,
    kickPlayer,
    lock,
    unlock,
    isLocked,

    start,
    startQuestion,
    submitAnswer,
    hasAnswered,
    answeredCount,
    getPlayerPayload,
    isQuestionDone,
    isPaused,
    pause,
    resume,
    elapsedAt,
    endQuestion,
    nextQuestion,
    isGameOver,

    getQuestionSummary,
    getQuestionStats,
    getFinalResults,
    getPlayerFinal,
    getResultsCSV,
    getLeaderboard,

    _getAnswerIdMapping: getAnswerIdMapping,
  };
}
