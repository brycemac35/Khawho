/**
 * Host flow module - manages quiz selection, game creation, and gameplay
 */

import { createHost, joinGame } from './transport/index.js';
import { createGame } from './game.js';
import * as protocol from './protocol.js';
import { randomPin } from './rng.js';
import { playLobbyMusic, playCountdownTick, playTimeUp, playPodiumFanfare, setMuted } from './sound.js';

// Global app state
const app = {
  // UI state
  currentScreen: 'quiz-select',
  selectedQuiz: null,
  selectedTransport: 'local', // Default to local for dev

  // Game state
  host: null,
  game: null,
  pin: null,
  players: new Map(), // clientId -> player state
  connections: new Map(), // clientId -> connection
  questionStartTime: null,
  timerInterval: null,
  questionTimer: null,
  paused: false,
  gameActive: false,

  // UI elements cache
  screens: {},
  elements: {},
};

// Initialize
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  console.log('Initializing host app');

  // Cache all screens
  app.screens = {
    quizSelect: document.getElementById('screen-quiz-select'),
    settings: document.getElementById('screen-settings'),
    lobby: document.getElementById('screen-lobby'),
    question: document.getElementById('screen-question'),
    results: document.getElementById('screen-results'),
    leaderboard: document.getElementById('screen-leaderboard'),
    final: document.getElementById('screen-final'),
  };

  // Set up tab switching
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
    });
  });

  // Load quizzes (stub)
  loadMyQuizzes();
}

function showScreen(screenName) {
  Object.values(app.screens).forEach(screen => screen.classList.add('hidden'));
  if (app.screens[screenName]) {
    app.screens[screenName].classList.remove('hidden');
  }
  app.currentScreen = screenName;
}

function loadMyQuizzes() {
  const list = document.getElementById('my-quizzes-list');
  list.innerHTML = '';

  // Try to get from localStorage (stub storage)
  const stored = localStorage.getItem('khawho.quizzes');
  if (stored) {
    try {
      const quizzes = JSON.parse(stored);
      quizzes.forEach(quiz => {
        const item = document.createElement('div');
        item.className = 'quiz-item';
        item.innerHTML = `
          <div class="quiz-item-title">${quiz.title}</div>
          <div class="quiz-item-meta">
            by ${quiz.author} • ${quiz.questions.length} questions
          </div>
        `;
        item.onclick = () => selectQuiz(quiz);
        list.appendChild(item);
      });
    } catch (e) {
      console.error('Failed to load quizzes:', e);
    }
  } else {
    list.innerHTML = '<p class="text-muted">No quizzes found. Create one in the editor.</p>';
  }
}

function selectQuiz(quiz) {
  app.selectedQuiz = quiz;
  showScreen('settings');
  loadConnectionOptions();
}

function loadConnectionOptions() {
  const container = document.getElementById('connection-options');
  container.innerHTML = '';

  // Detect available transports
  const options = [
    { kind: 'peerjs', label: 'Standard (PeerJS)', enabled: true },
    { kind: 'firebase', label: 'Backup (Firebase)', enabled: false, reason: 'Not set up' },
  ];

  // Add local transport in dev mode
  if (location.search.includes('dev=1')) {
    options.push({ kind: 'local', label: 'Local (Dev Testing)', enabled: true });
  }

  options.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'connection-option';
    if (!opt.enabled) div.style.opacity = '0.5';

    div.innerHTML = `
      <label class="connection-option-label">
        <input type="radio" name="transport" value="${opt.kind}" ${opt.enabled ? '' : 'disabled'} ${opt.kind === 'local' ? 'checked' : ''} />
        ${opt.label}
        ${opt.reason ? `<div class="connection-option-reason">${opt.reason}</div>` : ''}
      </label>
    `;
    div.addEventListener('change', (e) => {
      if (e.target.checked) app.selectedTransport = e.target.value;
    });
    container.appendChild(div);
  });

  // Pre-select local if dev mode
  if (location.search.includes('dev=1')) {
    document.querySelector('input[value="local"]').checked = true;
    app.selectedTransport = 'local';
  }
}

async function createGame() {
  const quiz = app.selectedQuiz;
  if (!quiz) {
    alert('Select a quiz first');
    return;
  }

  const settings = {
    shuffleQuestions: document.getElementById('shuffle-questions').checked,
    perPlayerOrder: document.getElementById('per-player-order').checked,
    randomNamesOnly: document.getElementById('random-names').checked,
  };

  // Store quiz and create game engine
  app.selectedQuiz = quiz;
  app.game = createGame(quiz, settings);

  // Create host connection
  app.pin = randomPin();
  try {
    app.host = await createHost(app.selectedTransport, { pin: app.pin });

    // Set up connection handler
    app.host.onConnection(conn => {
      console.log('New connection:', conn.id);
      app.connections.set(conn.id, conn);

      conn.onMessage((msg) => {
        handlePlayerMessage(conn.id, msg);
      });

      conn.onClose(() => {
        console.log('Connection closed:', conn.id);
        if (app.gameActive) {
          app.game.removePlayer(conn.id);
          updatePlayersList();
        } else {
          app.connections.delete(conn.id);
        }
      });
    });

    showScreen('lobby');
    updateLobbyDisplay();
    playLobbyMusic();
  } catch (error) {
    alert(`Failed to create game: ${error.message}`);
  }
}

function updateLobbyDisplay() {
  document.getElementById('pin-display').textContent = app.pin;
  updatePlayersList();
}

function updatePlayersList() {
  const list = document.getElementById('players-list');
  const count = app.game.players.size;
  list.innerHTML = '';

  document.getElementById('player-count').textContent = count;

  app.game.players.forEach((player, clientId) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `
      ${player.displayName}
      <span class="player-chip-remove" onclick="hostApp.kickPlayer('${clientId}')">×</span>
    `;
    list.appendChild(chip);
  });
}

function copyJoinUrl() {
  const baseUrl = location.origin + location.pathname.replace(/host\.html/, 'play.html');
  const joinUrl = `${baseUrl}?pin=${app.pin}&via=${app.selectedTransport}`;
  navigator.clipboard.writeText(joinUrl).then(() => {
    alert('Join URL copied to clipboard!');
  });
}

function toggleLock() {
  if (app.game.isLocked()) {
    app.game.unlock();
    document.getElementById('lock-button').textContent = 'Lock Lobby';
  } else {
    app.game.lock();
    document.getElementById('lock-button').textContent = 'Unlock Lobby';
  }
}

function toggleMute() {
  const currentMute = localStorage.getItem('khawho.muted') === 'true';
  setMuted(!currentMute);
  document.querySelector('button[onclick="hostApp.toggleMute()"]').textContent =
    currentMute ? '🔊 Sound' : '🔇 Muted';
}

function handlePlayerMessage(clientId, msg) {
  console.log('Player message:', clientId, msg);

  if (msg.t === protocol.MSG_JOIN) {
    // Player joining
    try {
      app.game.addPlayer(clientId, msg.name, msg.name);
      app.players.set(clientId, { name: msg.name, score: 0, streak: 0 });

      // Send welcome
      const conn = app.connections.get(clientId);
      conn.send(protocol.welcome(msg.name, 0));

      updatePlayersList();
    } catch (error) {
      const conn = app.connections.get(clientId);
      conn.send(protocol.reject(error.message));
    }
  } else if (msg.t === protocol.MSG_ANSWER) {
    // Player answering
    app.game.submitAnswer(clientId, msg.answer, Date.now());
  }
}

async function startGame() {
  if (app.game.players.size === 0) {
    alert('At least one player must join');
    return;
  }

  app.gameActive = true;
  app.game.start();

  // Tell all players the game started
  app.connections.forEach(conn => {
    conn.send(protocol.lobby());
  });

  nextQuestion();
}

function nextQuestion() {
  if (app.game.isGameOver()) {
    showFinalScreen();
    return;
  }

  showScreen('question');

  const now = Date.now();
  const result = app.game.startQuestion(now);
  app.questionStartTime = now;

  // Display question for host
  const qIdx = app.game.questionOrder[app.game.currentQuestionIndex];
  const q = app.selectedQuiz.questions[qIdx];
  document.getElementById('q-number').textContent = app.game.currentQuestionIndex + 1;
  document.getElementById('q-total').textContent = app.game.questionOrder.length;
  document.getElementById('question-text').textContent = result.hostView.text;

  if (result.hostView.image) {
    const img = document.getElementById('question-image');
    img.src = result.hostView.image;
    img.classList.remove('hidden');
  } else {
    document.getElementById('question-image').classList.add('hidden');
  }

  // Display answers for host
  const answerTiles = document.getElementById('answer-tiles');
  answerTiles.innerHTML = '';
  result.hostView.answers.forEach((ans, i) => {
    const tile = document.createElement('div');
    tile.className = 'answer-tile';
    tile.textContent = ans.text + ` (${result.hostView.answers.filter(a => a.text === ans.text).length})`;
    answerTiles.appendChild(tile);
  });

  // Send question to all players
  app.connections.forEach(conn => {
    const clientId = Array.from(app.connections.entries()).find(([, c]) => c === conn)?.[0];
    if (clientId && result.playerPayloads.has(clientId)) {
      const payload = result.playerPayloads.get(clientId);
      conn.send(protocol.question(
        payload.qIndex,
        payload.total,
        payload.type,
        payload.text,
        payload.image,
        payload.timeLimit,
        payload.multi,
        payload.answers
      ));
    }
  });

  // Start timer
  startQuestionTimer(result.hostView.timeLimit * 1000);
}

function startQuestionTimer(duration) {
  clearInterval(app.questionTimer);
  const endTime = Date.now() + duration;
  const q = app.game.game.questions[app.game.game.questionOrder[app.game.currentQuestionIndex]];

  // Countdown timer with 5-second warning
  app.questionTimer = setInterval(() => {
    const now = Date.now();
    const remaining = Math.max(0, endTime - now);
    const secondsLeft = Math.ceil(remaining / 1000);

    // Update display
    const ring = document.getElementById('countdown-ring');
    if (ring) {
      ring.textContent = Math.ceil(remaining / 1000);
    }

    // Play tick in last 5 seconds
    if (secondsLeft > 0 && secondsLeft <= 5 && remaining % 1000 < 100) {
      playCountdownTick();
    }

    // End question when timer expires
    if (remaining <= 0) {
      clearInterval(app.questionTimer);
      endQuestion();
    }
  }, 100);
}

function endQuestion() {
  clearInterval(app.questionTimer);
  playTimeUp();

  const now = Date.now();
  const results = app.game.endQuestion(now);

  // Show results
  showScreen('results');

  // Send reveal to all players
  app.connections.forEach(conn => {
    const clientId = Array.from(app.connections.entries()).find(([, c]) => c === conn)?.[0];
    if (clientId && results.has(clientId)) {
      const result = results.get(clientId);
      conn.send(protocol.reveal(
        result.correct,
        result.points,
        result.score,
        result.streak,
        result.rank,
        result.correctIds || [],
        result.correctText || []
      ));
    }
  });

  // Display distribution chart (simplified)
  displayDistribution(results);
}

function displayDistribution(results) {
  const chart = document.createElement('div');
  chart.className = 'distribution-chart';
  document.getElementById('distribution-chart').innerHTML = '';

  results.forEach((result, clientId) => {
    const bar = document.createElement('div');
    bar.className = 'distribution-bar';
    bar.innerHTML = `
      <div class="bar-graph ${result.correct ? 'correct' : ''}" style="height: ${result.score * 2}%"></div>
      <div class="bar-label">${app.players.get(clientId)?.name}</div>
    `;
    document.getElementById('distribution-chart').appendChild(bar);
  });
}

function showFinalScreen() {
  app.gameActive = false;
  showScreen('final');

  const results = app.game.getFinalResults();
  const podium = document.getElementById('podium');
  podium.innerHTML = '';

  // Top 3
  const medals = ['🥇', '🥈', '🥉'];
  results.leaderboard.slice(0, 3).forEach((player, i) => {
    const place = document.createElement('div');
    place.className = `podium-place podium-rank-${i + 1}`;
    place.innerHTML = `
      <div class="podium-medal">${medals[i]}</div>
      <div class="podium-name">${player.name}</div>
      <div class="podium-score">${player.score}</div>
    `;
    podium.appendChild(place);
  });

  playPodiumFanfare();
}

function skipQuestion() {
  app.game.nextQuestion();
  nextQuestion();
}

function endGame() {
  if (confirm('End game now?')) {
    if (app.host) {
      app.host.close();
    }
    location.href = 'index.html';
  }
}

function downloadResults() {
  const csv = app.game.getResultsCSV();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `khawho-results-${app.pin}.csv`;
  a.click();
}

// Export for HTML
window.hostApp = {
  selectQuiz,
  createGame,
  copyJoinUrl,
  toggleLock,
  toggleMute,
  startGame,
  nextQuestion,
  skipQuestion,
  togglePause: () => {}, // TODO: pause functionality
  endQuestion,
  endGame,
  downloadResults,
  kickPlayer: (clientId) => {
    app.game.kickPlayer(clientId);
    app.connections.get(clientId)?.send(protocol.kicked());
    updatePlayersList();
  },
  nextScreen: () => {
    // Results -> Leaderboard transition
    showScreen('leaderboard');
  },
};
