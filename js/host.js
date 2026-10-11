/**
 * Host flow module - manages quiz selection, game creation, and gameplay
 */

import { createHost, joinGame, availableKinds } from './transport/index.js';
import { createGame } from './game.js';
import * as protocol from './protocol.js';
import { randomPin } from './rng.js';
import { playLobbyMusic, playCountdownTick, playTimeUp, playPodiumFanfare, setMuted } from './sound.js';
import { listLocalQuizzes, getLocalQuiz, listLibrary, loadLibraryQuiz, getTeacherPassword, setTeacherPassword } from './storage.js';

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
  questionPausedTime: 0, // Total time spent paused
  questionPauseStartTime: null, // When pause started
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

  // Check for quiz in URL params
  const params = new URLSearchParams(location.search);
  if (params.has('quiz')) {
    const quizParam = params.get('quiz');
    if (quizParam.startsWith('local:')) {
      const id = quizParam.substring(6);
      const quiz = getLocalQuiz(id);
      if (quiz) {
        selectQuiz(quiz);
      }
    } else if (quizParam.startsWith('lib:')) {
      const path = quizParam.substring(4);
      loadAndSelectLibraryQuiz(path);
    }
  } else {
    // Load quizzes
    loadMyQuizzes();
    loadLibraryQuizzes();
  }
}

async function loadAndSelectLibraryQuiz(path) {
  try {
    const password = getTeacherPassword();
    if (!password) {
      promptForLibraryPassword(path);
      return;
    }
    const quiz = await loadLibraryQuiz(path, password);
    selectQuiz(quiz);
  } catch (error) {
    if (error.message.includes('Wrong teacher password')) {
      setTeacherPassword(null);
      promptForLibraryPassword(path);
    } else {
      showError('Error loading quiz: ' + error.message);
    }
  }
}

function promptForLibraryPassword(path) {
  const pwd = prompt('Enter teacher password to access this quiz:');
  if (pwd) {
    setTeacherPassword(pwd);
    loadAndSelectLibraryQuiz(path);
  }
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

  const quizzes = listLocalQuizzes();
  if (quizzes.length > 0) {
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
  } else {
    list.innerHTML = '<p class="text-muted">No quizzes found. Create one in the editor.</p>';
  }
}

async function loadLibraryQuizzes() {
  const list = document.getElementById('library-list');
  const prompt = document.getElementById('library-password-prompt');

  try {
    const quizzes = await listLibrary();
    list.innerHTML = '';

    if (quizzes.length > 0) {
      prompt.classList.add('hidden');
      quizzes.forEach(item => {
        const div = document.createElement('div');
        div.className = 'quiz-item';
        div.innerHTML = `
          <div class="quiz-item-title">${item.title}</div>
          <div class="quiz-item-meta">
            by ${item.author} • ${item.count} questions
          </div>
        `;
        div.onclick = () => selectLibraryQuiz(item.path);
        list.appendChild(div);
      });
    } else {
      list.innerHTML = '<p class="text-muted">Library is empty.</p>';
    }
  } catch (error) {
    list.innerHTML = `<p class="error-message">${error.message}</p>`;
  }
}

async function selectLibraryQuiz(path) {
  const password = getTeacherPassword();
  if (!password) {
    showLibraryPasswordPrompt(path);
    return;
  }

  try {
    const quiz = await loadLibraryQuiz(path, password);
    selectQuiz(quiz);
  } catch (error) {
    if (error.message.includes('Wrong teacher password')) {
      setTeacherPassword(null);
      showLibraryPasswordPrompt(path);
    } else {
      showError('Error: ' + error.message);
    }
  }
}

function showLibraryPasswordPrompt(path) {
  const prompt = document.getElementById('library-password-prompt');
  const input = document.getElementById('library-password');
  const errorDiv = document.getElementById('library-error');

  prompt.classList.remove('hidden');
  errorDiv.classList.add('hidden');

  input.onkeypress = async (e) => {
    if (e.key === 'Enter') {
      const password = input.value;
      if (password) {
        setTeacherPassword(password);
        try {
          const quiz = await loadLibraryQuiz(path, password);
          selectQuiz(quiz);
        } catch (error) {
          setTeacherPassword(null);
          errorDiv.textContent = error.message;
          errorDiv.classList.remove('hidden');
          input.value = '';
        }
      }
    }
  };

  input.focus();
}

function showError(message) {
  const errorDiv = document.getElementById('library-error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
  } else {
    alert(message);
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

  const options = availableKinds();

  options.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'connection-option';
    if (!opt.enabled) div.style.opacity = '0.5';

    const reasonText = opt.kind === 'firebase' && !opt.enabled
      ? '<div class="connection-option-reason">Not set up — see README</div>'
      : '';

    div.innerHTML = `
      <label class="connection-option-label">
        <input type="radio" name="transport" value="${opt.kind}" ${opt.enabled ? '' : 'disabled'} />
        ${opt.label}
        ${reasonText}
      </label>
    `;
    div.addEventListener('change', (e) => {
      if (e.target.checked) app.selectedTransport = e.target.value;
    });
    container.appendChild(div);
  });

  // Pre-select first enabled option
  const firstEnabled = options.find(o => o.enabled);
  if (firstEnabled) {
    document.querySelector(`input[value="${firstEnabled.kind}"]`).checked = true;
    app.selectedTransport = firstEnabled.kind;
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

async function updateLobbyDisplay() {
  document.getElementById('pin-display').textContent = app.pin;
  updatePlayersList();

  // Try to add QR code
  try {
    const qrHtml = await generateQRCode();
    if (qrHtml) {
      const qrContainer = document.createElement('div');
      qrContainer.className = 'qr-code-container';
      qrContainer.innerHTML = qrHtml;
      const pinSection = document.querySelector('.pin-section');
      if (pinSection) {
        // Remove old QR if exists
        const oldQr = pinSection.querySelector('.qr-code-container');
        if (oldQr) oldQr.remove();
        pinSection.appendChild(qrContainer);
      }
    }
  } catch (e) {
    console.warn('QR code generation failed:', e);
  }
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
  app.questionPausedTime = 0;
  app.questionPauseStartTime = null;
  app.paused = false;

  const endTime = Date.now() + duration;

  // Countdown timer with 5-second warning
  app.questionTimer = setInterval(() => {
    if (app.paused) {
      const ring = document.getElementById('countdown-ring');
      if (ring) ring.textContent = '⏸';
      return;
    }

    const now = Date.now();
    const elapsed = now - app.questionStartTime - app.questionPausedTime;
    const remaining = Math.max(0, duration - elapsed);
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
      app.paused = false;
      endQuestion();
    }
  }, 100);
}

function togglePause() {
  if (!app.gameActive) return;

  app.paused = !app.paused;
  const btn = document.getElementById('pause-button');

  if (app.paused) {
    app.questionPauseStartTime = Date.now();
    btn.textContent = 'Resume';

    // Notify all players
    app.connections.forEach(conn => {
      conn.send(protocol.paused(true));
    });
  } else {
    if (app.questionPauseStartTime) {
      app.questionPausedTime += Date.now() - app.questionPauseStartTime;
      app.questionPauseStartTime = null;
    }
    btn.textContent = 'Pause';

    // Notify all players
    app.connections.forEach(conn => {
      conn.send(protocol.paused(false));
    });
  }
}

function endQuestion() {
  clearInterval(app.questionTimer);
  app.paused = false;
  playTimeUp();

  // Calculate elapsed time excluding paused time
  const now = Date.now();
  const totalElapsed = now - app.questionStartTime;
  const effectiveElapsed = now - (totalElapsed > app.questionPausedTime ? app.questionPausedTime : 0);

  const results = app.game.endQuestion(effectiveElapsed);

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
  // Build CSV: player, rank, score, then per-question answer/correct/points
  const leaderboard = app.game.getFinalResults().leaderboard;
  const totalQuestions = app.game.questionOrder.length;

  // Headers
  const headers = ['Player', 'Rank', 'Score'];
  for (let i = 0; i < totalQuestions; i++) {
    headers.push(`Q${i + 1} Answer`, `Q${i + 1} Correct`, `Q${i + 1} Points`);
  }

  const lines = [headers.join(',')];

  // Data rows
  leaderboard.forEach((player, idx) => {
    const row = [
      `"${player.name}"`,
      player.rank,
      player.score,
    ];

    // Add per-question data
    for (let i = 0; i < totalQuestions; i++) {
      row.push(''); // Answer text (would need to track during game)
      row.push(''); // Correct (would need to track during game)
      row.push(''); // Points (would need to track during game)
    }

    lines.push(row.join(','));
  });

  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `khawho-results-${app.pin}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function generateQRCode() {
  const baseUrl = location.origin + location.pathname.replace(/host\.html/, 'play.html');
  const joinUrl = `${baseUrl}?pin=${app.pin}&via=${app.selectedTransport}`;

  // Load QR code library lazily
  if (!window.qrcode) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    script.onerror = () => {
      console.warn('Failed to load QR code library');
      return;
    };
    document.head.appendChild(script);

    // Wait for script to load
    await new Promise(resolve => {
      script.onload = resolve;
      setTimeout(resolve, 3000); // Timeout after 3s
    });
  }

  if (!window.qrcode) return null;

  // Generate QR code
  try {
    const qr = window.qrcode(10, 'L');
    qr.addData(joinUrl);
    qr.make();
    return qr.createImgTag(5, 0);
  } catch (e) {
    console.warn('QR code generation failed:', e);
    return null;
  }
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
  togglePause,
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
  loadLibrary: loadLibraryQuizzes,
};
