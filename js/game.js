/**
 * Pure game engine (no DOM, no network; Node-testable)
 * Host-authoritative state machine for Khawho quiz gameplay
 */

import { randomInt, shuffle, randomId } from './rng.js';

/**
 * Create a game state machine
 * @param {object} quiz - Quiz object with questions array
 * @param {object} settings - {shuffleQuestions, perPlayerOrder, randomNamesOnly, maxPlayers}
 * @returns {object} Game state machine
 */
export function createGame(quiz, settings = {}) {
  const {
    shuffleQuestions = true,
    perPlayerOrder = false,
    randomNamesOnly = false,
    maxPlayers = 60,
  } = settings;

  // Validate quiz
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
    throw new Error('Invalid quiz: must have questions array');
  }

  // Shapes and colors for MC/TF/poll (4 tiles)
  const shapes = ['triangle', 'diamond', 'circle', 'square'];
  const colors = ['red', 'blue', 'yellow', 'green'];

  // Question order (shuffled if enabled)
  let questionOrder = shuffleQuestions
    ? shuffle([...Array(quiz.questions.length).keys()])
    : [...Array(quiz.questions.length).keys()];

  // Player state: Map<clientId, { name, score, streak, answers: {} }>
  const players = new Map();
  const playerNames = new Map(); // clientId -> display name
  const rejoinIds = new Map(); // clientId -> original stats for rejoin

  // Game state
  let currentQuestionIndex = -1; // -1 = not started, 0+ = question index in questionOrder
  let gameStarted = false;
  let gameLocked = false;
  let questionStartTime = null; // ms since epoch when question started
  let paused = false;

  // Per-question state
  let questionAnswers = new Map(); // clientId -> answer
  let questionAnswerIds = new Map(); // Maps random answer ID back to original answer index

  // Per-game randomness state
  let perQuestionShapeColorMappings = new Map(); // qIndex -> [shape, color] pairs per player
  let perQuestionAnswerOrders = new Map(); // qIndex -> answerOrder (or Map<clientId, answerOrder> if perPlayerOrder)

  /**
   * Normalize answer text for type-answer questions
   */
  function normalizeAnswer(text) {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Check if a type answer matches the accepted list
   */
  function checkTypeAnswer(answer, accepted) {
    const normalized = normalizeAnswer(answer);
    return accepted.some(acc => normalizeAnswer(acc) === normalized);
  }

  /**
   * Get shape/color mapping for a question and player
   * Returns array of 4 [shape, color] pairs, same order each game for same player
   */
  function getShapeColorPair(qIndex, clientId) {
    const key = `${qIndex}-${clientId || 'host'}`;
    if (!perQuestionShapeColorMappings.has(qIndex)) {
      perQuestionShapeColorMappings.set(qIndex, new Map());
    }
    const qMap = perQuestionShapeColorMappings.get(qIndex);
    if (!qMap.has(key)) {
      // Generate a random shape/color pairing for this player/question
      const shapeShuffle = shuffle(shapes);
      const colorShuffle = shuffle(colors);
      const pairing = shapeShuffle.map((s, i) => [s, colorShuffle[i]]);
      qMap.set(key, pairing);
    }
    return qMap.get(key);
  }

  /**
   * Add or rejoin a player
   */
  function addPlayer(clientId, name, displayName) {
    if (players.size >= maxPlayers && !players.has(clientId)) {
      throw new Error(`Game full (max ${maxPlayers} players)`);
    }

    playerNames.set(clientId, displayName || name);

    // Rejoin: restore previous stats
    if (rejoinIds.has(clientId)) {
      const previous = rejoinIds.get(clientId);
      players.set(clientId, {
        name,
        displayName: displayName || name,
        score: previous.score,
        streak: previous.streak,
        answers: {},
      });
    } else {
      players.set(clientId, {
        name,
        displayName: displayName || name,
        score: 0,
        streak: 0,
        answers: {},
      });
      rejoinIds.set(clientId, { score: 0, streak: 0 });
    }
  }

  function removePlayer(clientId) {
    const player = players.get(clientId);
    if (player) {
      // Save state for potential rejoin
      rejoinIds.set(clientId, { score: player.score, streak: player.streak });
      players.delete(clientId);
      playerNames.delete(clientId);
    }
  }

  function kickPlayer(clientId) {
    // Kick: don't allow rejoin
    players.delete(clientId);
    playerNames.delete(clientId);
    rejoinIds.delete(clientId);
  }

  function lock() {
    gameLocked = true;
  }

  function unlock() {
    gameLocked = false;
  }

  function isLocked() {
    return gameLocked;
  }

  /**
   * Start the game (move to first question)
   */
  function start() {
    gameStarted = true;
    currentQuestionIndex = 0;
  }

  /**
   * Start a question, returning per-player payloads
   * Returns { hostView, playerPayloads: Map<clientId, payload> }
   */
  function startQuestion(now) {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= questionOrder.length) {
      throw new Error('Invalid question index');
    }

    questionStartTime = now;
    questionAnswers.clear();
    questionAnswerIds.clear();
    paused = false;

    const qIdx = questionOrder[currentQuestionIndex];
    const q = quiz.questions[qIdx];
    const qNum = currentQuestionIndex + 1;
    const total = questionOrder.length;

    // Determine if multi-correct for this question
    const multi = q.type !== 'tf' && q.type !== 'poll' && q.type !== 'type'
      && q.answers.filter(a => a.correct).length > 1;

    const playerPayloads = new Map();
    let hostAnswers = [];

    if (q.type === 'type') {
      // Type-answer: no answer tiles, just text input
      players.forEach((player, clientId) => {
        playerPayloads.set(clientId, {
          qIndex: currentQuestionIndex,
          total,
          type: 'type',
          text: q.text,
          image: q.image || null,
          timeLimit: q.timeLimit,
          multi: false,
          answers: [], // Empty for type-answer
        });
      });
      hostAnswers = q.answers.map((a, i) => ({
        text: a.text,
        correct: a.correct,
      }));
    } else if (q.type === 'poll') {
      // Poll: all answers, no correct
      const answerOrder = perPlayerOrder
        ? new Map(players.keys().map(cid => [cid, shuffle([...Array(q.answers.length).keys()])]))
        : shuffle([...Array(q.answers.length).keys()]);

      perQuestionAnswerOrders.set(currentQuestionIndex, answerOrder);

      players.forEach((player, clientId) => {
        const order = perPlayerOrder ? answerOrder.get(clientId) : answerOrder;
        const answers = order.map((i) => {
          const answerId = randomId(4);
          questionAnswerIds.set(`${currentQuestionIndex}-${answerId}`, i);
          return {
            id: answerId,
            text: q.answers[i].text,
            shape: null,
            color: null,
          };
        });

        playerPayloads.set(clientId, {
          qIndex: currentQuestionIndex,
          total,
          type: 'poll',
          text: q.text,
          image: q.image || null,
          timeLimit: q.timeLimit,
          multi: false,
          answers,
        });
      });

      hostAnswers = q.answers.map((a, i) => ({ text: a.text }));
    } else {
      // MC or TF: with shapes and colors
      const answerOrder = perPlayerOrder
        ? new Map(players.keys().map(cid => [cid, shuffle([...Array(q.answers.length).keys()])]))
        : shuffle([...Array(q.answers.length).keys()]);

      perQuestionAnswerOrders.set(currentQuestionIndex, answerOrder);

      players.forEach((player, clientId) => {
        const order = perPlayerOrder ? answerOrder.get(clientId) : answerOrder;
        const shapeColorPairs = perPlayerOrder ? getShapeColorPair(currentQuestionIndex, clientId) : getShapeColorPair(currentQuestionIndex);

        const answers = order.map((i) => {
          const answerId = randomId(4);
          questionAnswerIds.set(`${currentQuestionIndex}-${answerId}`, i);
          const [shape, color] = shapeColorPairs[i];
          return {
            id: answerId,
            text: q.answers[i].text,
            shape,
            color,
          };
        });

        playerPayloads.set(clientId, {
          qIndex: currentQuestionIndex,
          total,
          type: q.type,
          text: q.text,
          image: q.image || null,
          timeLimit: q.timeLimit,
          multi,
          answers,
        });
      });

      hostAnswers = q.answers.map((a, i) => ({
        text: a.text,
        correct: a.correct,
      }));
    }

    // For each player, if they haven't joined yet, mark them late
    // When startQuestion is called, late joiners get 0 for this question

    return {
      hostView: {
        qIndex: currentQuestionIndex,
        total: questionOrder.length,
        type: q.type,
        text: q.text,
        image: q.image || null,
        timeLimit: q.timeLimit,
        answers: hostAnswers,
        playerCount: players.size,
      },
      playerPayloads,
    };
  }

  /**
   * Submit an answer from a player
   */
  function submitAnswer(clientId, answer, now) {
    if (!players.has(clientId)) {
      throw new Error(`Player ${clientId} not found`);
    }

    // Don't record if already answered
    if (questionAnswers.has(clientId)) {
      return false; // Already answered
    }

    questionAnswers.set(clientId, answer);

    // Calculate elapsed time
    const elapsed = Math.max(0, now - questionStartTime);
    const qIdx = questionOrder[currentQuestionIndex];
    const q = quiz.questions[qIdx];

    return true; // Recorded
  }

  /**
   * Check if the current question is done (all answered or time limit reached)
   */
  function isQuestionDone(now) {
    const qIdx = questionOrder[currentQuestionIndex];
    const q = quiz.questions[qIdx];
    const elapsed = Math.max(0, now - questionStartTime);

    // Done if all players answered
    if (questionAnswers.size === players.size) {
      return true;
    }

    // Done if time limit reached
    if (elapsed >= q.timeLimit * 1000) {
      return true;
    }

    return false;
  }

  /**
   * End the current question, returning results
   */
  function endQuestion(now) {
    if (currentQuestionIndex < 0 || currentQuestionIndex >= questionOrder.length) {
      throw new Error('No active question');
    }

    const qIdx = questionOrder[currentQuestionIndex];
    const q = quiz.questions[qIdx];
    const elapsed = Math.max(0, now - questionStartTime);

    // Determine correct answers (original indices)
    const correctIndices = [];
    q.answers.forEach((a, i) => {
      if (a.correct) {
        correctIndices.push(i);
      }
    });

    // Score each player
    const results = new Map();

    players.forEach((player, clientId) => {
      const answer = questionAnswers.get(clientId);
      let correct = null;
      let points = 0;
      let correctIds = [];
      let correctText = correctIndices.map(i => q.answers[i].text);

      if (answer === undefined) {
        // Didn't answer (timeout or late join)
        correct = false;
        points = 0;
      } else {
        // Evaluate answer
        if (q.type === 'type') {
          // Type-answer
          const accepted = q.accepted || [];
          correct = checkTypeAnswer(answer, accepted);
        } else if (q.type === 'poll') {
          // Poll: no points
          correct = null;
          points = 0;
        } else {
          // MC or TF
          let submittedIndices = [];
          if (Array.isArray(answer)) {
            // Map answer IDs back to original indices
            submittedIndices = answer
              .map(id => questionAnswerIds.get(`${currentQuestionIndex}-${id}`))
              .filter(i => i !== undefined)
              .sort((a, b) => a - b);
          }

          if (submittedIndices.length === 0) {
            correct = false;
          } else if (correctIndices.length === 1) {
            // Single correct answer
            correct = submittedIndices.length === 1 && submittedIndices[0] === correctIndices[0];
          } else {
            // Multi-correct: must match exact set
            const sortedCorrect = [...correctIndices].sort((a, b) => a - b);
            correct = submittedIndices.length === sortedCorrect.length
              && submittedIndices.every((idx, j) => idx === sortedCorrect[j]);
          }

          if (correct) {
            // Map correct indices back to their answer IDs for this player
            correctIds = correctIndices.map(i => {
              // Find which answer ID corresponds to original index i
              for (const [key, origIdx] of questionAnswerIds) {
                if (origIdx === i && key.startsWith(`${currentQuestionIndex}-`)) {
                  return key.substring(key.indexOf('-') + 1);
                }
              }
              return null;
            }).filter(id => id);
          }
        }
      }

      // Calculate points
      if (q.type === 'poll' || answer === undefined) {
        points = 0;
      } else if (correct) {
        const timeMs = q.timeLimit * 1000;
        const basePoints = Math.round(1000 * (1 - (elapsed / timeMs) / 2));
        points = Math.max(500, Math.min(1000, basePoints));

        // Apply multiplier if applicable
        if (q.points === 'double') {
          points *= 2;
        } else if (q.points === 'none') {
          points = 0;
        }

        // Streak bonus
        const streak = player.streak + 1;
        if (streak > 1) {
          const streakBonus = Math.min(500, (streak - 1) * 100);
          points += streakBonus;
        }

        player.streak = streak;
      } else {
        // Wrong answer or no answer
        points = 0;
        player.streak = 0;
      }

      // Update player score
      player.score += points;

      // Calculate rank
      const leaderboard = Array.from(players.values())
        .sort((a, b) => b.score - a.score);
      const rank = leaderboard.findIndex(p => p === player) + 1;

      results.set(clientId, {
        correct,
        points,
        score: player.score,
        streak: player.streak,
        rank,
        correctIds,
        correctText,
      });
    });

    return results;
  }

  /**
   * Move to next question
   */
  function nextQuestion() {
    currentQuestionIndex++;
  }

  /**
   * Check if game is over
   */
  function isGameOver() {
    return currentQuestionIndex >= questionOrder.length;
  }

  /**
   * Get final results
   */
  function getFinalResults() {
    const leaderboard = Array.from(players.values())
      .map((p, i) => ({
        rank: i + 1,
        name: p.displayName,
        score: p.score,
      }))
      .sort((a, b) => b.score - a.score);

    return {
      leaderboard,
      totalQuestions: questionOrder.length,
    };
  }

  /**
   * Get results CSV
   */
  function getResultsCSV() {
    const leaderboard = Array.from(players.values())
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({
        rank: i + 1,
        ...p,
      }));

    // Header
    const headers = ['Rank', 'Player', 'Score', 'Streak'];
    leaderboard.forEach((_, i) => {
      headers.push(`Q${i + 1}`);
    });

    const lines = [headers.join(',')];

    // Data rows
    leaderboard.forEach((player) => {
      const row = [player.rank, `"${player.displayName}"`, player.score, player.streak];
      questionOrder.forEach((qIdx, i) => {
        const answer = player.answers[i] || '';
        row.push(`"${answer}"`);
      });
      lines.push(row.join(','));
    });

    return lines.join('\n');
  }

  /**
   * Get leaderboard
   */
  function getLeaderboard() {
    return Array.from(players.values())
      .map((p) => ({
        name: p.displayName,
        score: p.score,
        streak: p.streak,
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get answer ID mapping for current question (for testing)
   * Returns Map<answerId, originalIndex>
   */
  function getAnswerIdMapping() {
    const mapping = new Map();
    questionAnswerIds.forEach((origIdx, key) => {
      if (key.startsWith(`${currentQuestionIndex}-`)) {
        const answerId = key.substring(key.indexOf('-') + 1);
        mapping.set(answerId, origIdx);
      }
    });
    return mapping;
  }

  // Public API
  return {
    // State accessors
    get gameStarted() { return gameStarted; },
    get currentQuestionIndex() { return currentQuestionIndex; },
    get questionOrder() { return [...questionOrder]; },
    get players() { return new Map(players); },
    get playerNames() { return new Map(playerNames); },

    // Player management
    addPlayer,
    removePlayer,
    kickPlayer,
    lock,
    unlock,
    isLocked,

    // Game flow
    start,
    startQuestion,
    submitAnswer,
    isQuestionDone,
    endQuestion,
    nextQuestion,
    isGameOver,

    // Results
    getFinalResults,
    getResultsCSV,
    getLeaderboard,

    // Internal/testing
    _getAnswerIdMapping: getAnswerIdMapping,
  };
}
