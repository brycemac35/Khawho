/**
 * Host flow: pick quiz -> settings -> lobby -> questions -> results/leaderboard -> podium.
 * The host page is the authority: it owns the game engine and the timer, and it is the only
 * place that knows which answers are correct.
 */

import { createHost, availableKinds } from './transport/index.js';
import { createGame as createEngine } from './game.js';
import * as protocol from './protocol.js';
import { randomPin } from './rng.js';
import { validateName, randomName } from './names.js';
import { validateQuiz, normalizeQuiz } from './quiz.js';
import {
  playLobbyMusic, playCountdownTick, playTimeUp, playPodiumFanfare, setMuted, isMutedState,
} from './sound.js';
import {
  listLocalQuizzes, getLocalQuiz, listLibrary, loadLibraryQuiz,
  getTeacherPassword, setTeacherPassword, forgetTeacherPassword,
} from './storage.js';

const app = {
  selectedQuiz: null,
  selectedTransport: null,
  host: null,
  game: null,
  pin: null,
  conns: new Map(), // connId -> { conn, clientId|null }
  clientConn: new Map(), // clientId -> conn
  lastReveal: new Map(), // clientId -> reveal message for the question just finished
  timer: null,
  lobbyMusic: null,
  phase: 'quiz-select', // quiz-select | settings | lobby | question | results | leaderboard | final
  pendingLibraryPath: null,
  screens: {},
};

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder. Everything user-controlled goes through textContent. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  children.flat().forEach(c => {
    if (c !== null && c !== undefined) node.append(c);
  });
  return node;
}

/** Sound must never break the game (e.g. AudioContext blocked). */
function safe(fn, ...args) {
  try { fn(...args); } catch (e) { console.warn('sound failed', e); }
}

function showError(id, message) {
  const box = $(id);
  if (!box) return;
  box.textContent = message || '';
  box.classList.toggle('hidden', !message);
}

function showScreen(name) {
  Object.entries(app.screens).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
  app.phase = name;
}

// ---------------------------------------------------------------- quiz picking

function initApp() {
  app.screens = {
    'quiz-select': $('screen-quiz-select'),
    settings: $('screen-settings'),
    lobby: $('screen-lobby'),
    question: $('screen-question'),
    results: $('screen-results'),
    leaderboard: $('screen-leaderboard'),
    final: $('screen-final'),
  };

  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      $(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'library' && !app.libraryLoaded) loadLibraryQuizzes();
    });
  });

  $('library-password-prompt').addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = $('library-password').value;
    if (!pwd || !app.pendingLibraryPath) return;
    openLibraryQuiz(app.pendingLibraryPath, pwd);
  });

  window.addEventListener('beforeunload', (e) => {
    if (app.phase !== 'quiz-select' && app.phase !== 'settings' && app.phase !== 'final') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  showScreen('quiz-select');
  loadMyQuizzes();

  const quizParam = new URLSearchParams(location.search).get('quiz');
  if (quizParam?.startsWith('local:')) {
    const quiz = getLocalQuiz(quizParam.slice(6));
    if (quiz) selectQuiz(quiz);
    else showError('quiz-error', 'That quiz was not found on this computer.');
  } else if (quizParam?.startsWith('lib:')) {
    activateTab('library');
    openLibraryQuiz(quizParam.slice(4), getTeacherPassword());
  }
}

function activateTab(name) {
  document.getElementById(`tabbtn-${name}`).click();
}

function loadMyQuizzes() {
  const list = $('my-quizzes-list');
  list.replaceChildren();
  const quizzes = listLocalQuizzes();
  if (quizzes.length === 0) {
    list.append(el('p', { class: 'text-muted' }, 'No quizzes yet. ',
      el('a', { href: 'editor.html', class: 'inline-link' }, 'Make one in the editor'),
      ' or pick one from the Shared Library.'));
    return;
  }
  quizzes.forEach(quiz => list.append(quizButton(quiz.title, quiz.author, quiz.questions?.length ?? 0, () => selectQuiz(quiz))));
}

function quizButton(title, author, count, onClick) {
  return el('button', { type: 'button', class: 'quiz-item', onclick: onClick },
    el('span', { class: 'quiz-item-title', text: title || 'Untitled' }),
    el('span', { class: 'quiz-item-meta', text: `${author ? 'by ' + author + ' • ' : ''}${count} question${count === 1 ? '' : 's'}` }));
}

async function loadLibraryQuizzes() {
  const list = $('library-list');
  const status = $('library-status');
  status.textContent = 'Loading the shared library…';
  list.replaceChildren();
  try {
    const items = await listLibrary();
    app.libraryLoaded = true;
    status.textContent = items.length ? 'Pick a quiz. You will need the teacher password.' : 'The shared library is empty.';
    items.forEach(item => list.append(quizButton(item.title, item.author, item.count, () => openLibraryQuiz(item.path, getTeacherPassword()))));
  } catch (error) {
    status.textContent = `Could not load the library: ${error.message}`;
    status.append(' ', el('button', { type: 'button', class: 'btn btn-secondary', onclick: loadLibraryQuizzes }, 'Try again'));
  }
}

async function openLibraryQuiz(path, password) {
  showError('quiz-error', '');
  app.pendingLibraryPath = path;
  if (!password) {
    $('library-password-prompt').classList.remove('hidden');
    $('library-password').focus();
    return;
  }
  try {
    const quiz = await loadLibraryQuiz(path, password);
    setTeacherPassword(password);
    $('library-password-prompt').classList.add('hidden');
    $('library-password').value = '';
    selectQuiz(quiz);
  } catch (error) {
    if (/Wrong teacher password/i.test(error.message)) {
      forgetTeacherPassword();
      $('library-password-prompt').classList.remove('hidden');
      $('library-password').value = '';
      $('library-password').focus();
      showError('quiz-error', 'That password did not work. Please try again.');
    } else {
      showError('quiz-error', error.message);
    }
  }
}

function selectQuiz(raw) {
  const quiz = normalizeQuiz(raw);
  const check = validateQuiz(quiz);
  if (!check.ok) {
    const first = check.errors[0];
    activateTab('my-quizzes');
    showError('quiz-error', `This quiz cannot be played yet: ${first.qIndex !== undefined ? `question ${first.qIndex + 1}: ` : ''}${first.message}`);
    return;
  }
  showError('quiz-error', '');
  app.selectedQuiz = quiz;
  $('settings-quiz-title').textContent = `${quiz.title} — ${quiz.questions.length} questions`;
  showScreen('settings');
  loadConnectionOptions();
}

function backToQuizzes() {
  showScreen('quiz-select');
}

function loadConnectionOptions() {
  const container = $('connection-options');
  container.replaceChildren();
  const options = availableKinds();
  const firstEnabled = options.find(o => o.enabled);
  app.selectedTransport = firstEnabled ? firstEnabled.kind : null;

  options.forEach(opt => {
    const input = el('input', {
      type: 'radio', name: 'transport', value: opt.kind,
      disabled: !opt.enabled, checked: firstEnabled && opt.kind === firstEnabled.kind,
    });
    input.addEventListener('change', () => { if (input.checked) app.selectedTransport = opt.kind; });
    const label = opt.kind === 'peerjs' ? 'Standard (PeerJS)' : opt.kind === 'firebase' ? 'Backup (Firebase)' : opt.label;
    container.append(el('label', { class: 'connection-option' }, input, ' ', label,
      !opt.enabled && opt.kind === 'firebase' ? el('span', { class: 'connection-option-reason', text: ' Not set up yet — see README' }) : null));
  });
}

// ---------------------------------------------------------------- game creation

async function createGame() {
  const quiz = app.selectedQuiz;
  if (!quiz) return;
  const button = $('create-game-button');
  showError('settings-error', '');
  button.disabled = true;
  button.textContent = 'Creating game…';

  const settings = {
    shuffleQuestions: $('shuffle-questions').checked,
    perPlayerOrder: $('per-player-order').checked,
    randomNamesOnly: $('random-names').checked,
  };
  app.settings = settings;

  try {
    app.game = createEngine(quiz, settings);
    let lastError = null;
    for (let attempt = 0; attempt < 4 && !app.host; attempt++) {
      const pin = randomPin();
      try {
        app.host = await createHost(app.selectedTransport, { pin });
        app.pin = pin;
      } catch (e) {
        lastError = e;
        if (!/already|taken|in use/i.test(e.message)) break;
      }
    }
    if (!app.host) throw lastError || new Error('Could not create a game');

    app.host.onConnection(onConnection);
    showScreen('lobby');
    renderLobby();
    startLobbyMusic();
  } catch (error) {
    showError('settings-error', `Could not create the game: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Create Game';
  }
}

function joinUrl() {
  const url = new URL('play.html', location.href);
  url.search = '';
  url.searchParams.set('pin', app.pin);
  url.searchParams.set('via', app.selectedTransport);
  return url.href;
}

function startLobbyMusic() {
  safe(playLobbyMusic);
  app.lobbyMusic = setInterval(() => {
    if (app.phase === 'lobby') safe(playLobbyMusic);
  }, 3000);
}

function renderLobby() {
  $('pin-display').textContent = app.pin;
  const playUrl = new URL('play.html', location.href);
  $('join-site').textContent = playUrl.host + playUrl.pathname;
  $('join-url').textContent = joinUrl();
  $('mute-button').textContent = isMutedState() ? 'Sound off' : 'Sound on';
  renderPlayers();
  showQr();
}

async function showQr() {
  const slot = $('qr-slot');
  slot.replaceChildren();
  slot.classList.add('hidden');
  try {
    const qrcode = await loadQrLib();
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl());
    qr.make();
    const img = el('img', { src: qr.createDataURL(6, 2), alt: 'QR code to join the game', width: 200, height: 200 });
    slot.append(img);
    slot.classList.remove('hidden');
  } catch (e) {
    console.warn('QR code unavailable:', e.message); // lobby still works with the PIN and link
  }
}

let qrPromise = null;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrPromise) {
    qrPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      script.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR library missing')));
      script.onerror = () => { qrPromise = null; reject(new Error('QR library failed to load')); };
      document.head.append(script);
    });
  }
  return qrPromise;
}

function renderPlayers() {
  const players = [...app.game.players];
  $('player-count').textContent = players.length;
  [$('players-list'), $('game-players-list')].forEach(list => {
    list.replaceChildren();
    players.forEach(([clientId, player]) => {
      list.append(el('div', { class: 'player-chip' },
        el('span', { text: player.displayName }),
        el('button', {
          type: 'button', class: 'player-chip-remove', 'aria-label': `Remove ${player.displayName}`,
          onclick: () => kickPlayer(clientId),
        }, '×')));
    });
  });
  $('answered-count').textContent = app.phase === 'question' ? app.game.answeredCount() : 0;
}

function kickPlayer(clientId) {
  safeSend(clientId, protocol.kicked());
  app.game.kickPlayer(clientId);
  app.clientConn.delete(clientId);
  renderPlayers();
  if (app.phase === 'question') checkQuestionDone();
}

function copyJoinUrl() {
  const url = joinUrl();
  const done = () => showError('lobby-error', '');
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(done).catch(() => {
    showError('lobby-error', `Copy this link: ${url}`);
  });
}

function toggleLock() {
  const locked = !app.game.isLocked();
  if (locked) app.game.lock(); else app.game.unlock();
  $('lock-button').textContent = locked ? 'Unlock Lobby' : 'Lock Lobby';
}

function toggleMute() {
  setMuted(!isMutedState());
  $('mute-button').textContent = isMutedState() ? 'Sound off' : 'Sound on';
}

// ---------------------------------------------------------------- networking

function safeSend(clientId, msg) {
  try { app.clientConn.get(clientId)?.send(msg); } catch (e) { console.warn('send failed', e); }
}

function broadcast(msg) {
  app.clientConn.forEach(conn => {
    try { conn.send(msg); } catch (e) { console.warn('send failed', e); }
  });
}

function onConnection(conn) {
  const entry = { conn, clientId: null };
  app.conns.set(conn.id, entry);
  conn.onMessage(msg => handleMessage(entry, msg));
  conn.onClose(() => handleClose(entry));
}

function handleClose(entry) {
  app.conns.delete(entry.conn.id);
  const { clientId, conn } = entry;
  if (clientId && app.clientConn.get(clientId) === conn) {
    app.clientConn.delete(clientId);
    app.game.removePlayer(clientId);
    renderPlayers();
    if (app.phase === 'question') checkQuestionDone();
  }
}

function handleMessage(entry, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === protocol.MSG_JOIN) handleJoin(entry, msg);
  else if (msg.t === protocol.MSG_ANSWER) handleAnswer(entry, msg);
}

function handleJoin(entry, msg) {
  const { conn } = entry;
  const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : conn.id;
  const game = app.game;

  // Rejoin: same clientId comes back (refresh, lost connection, new tab)
  if (game.hasPlayer(clientId)) {
    const old = app.clientConn.get(clientId);
    if (old && old !== conn) {
      app.conns.get(old.id) && (app.conns.get(old.id).clientId = null);
      try { old.close(); } catch { /* already gone */ }
    }
    const name = game.getDisplayName(clientId);
    game.addPlayer(clientId, name, name);
    entry.clientId = clientId;
    app.clientConn.set(clientId, conn);
    conn.send(protocol.welcome(name, game.getScore(clientId)));
    resendState(clientId);
    renderPlayers();
    return;
  }

  if (game.isLocked()) {
    conn.send(protocol.reject('This game is locked. Ask your teacher.'));
    return;
  }

  const taken = [...game.players.values()].map(p => p.displayName);
  let name;
  if (app.settings.randomNamesOnly) {
    do { name = randomName(); } while (taken.some(t => t.toLowerCase() === name.toLowerCase()));
  } else {
    const check = validateName(msg.name, taken);
    if (!check.ok) {
      conn.send(protocol.reject(check.reason));
      return;
    }
    name = check.name;
  }

  try {
    game.addPlayer(clientId, name, name);
  } catch (e) {
    conn.send(protocol.reject(e.message));
    return;
  }
  entry.clientId = clientId;
  app.clientConn.set(clientId, conn);
  conn.send(protocol.welcome(name, 0));
  renderPlayers();
}

/** Bring a (re)joining player up to date with whatever is on the host screen. */
function resendState(clientId) {
  if (app.game.isPaused()) safeSend(clientId, protocol.paused(true));
  if (app.phase === 'question') {
    const payload = app.game.getPlayerPayload(clientId);
    if (payload) {
      if (app.game.hasAnswered(clientId)) safeSend(clientId, protocol.answered());
      else sendQuestion(clientId, payload);
    }
  } else if (app.phase === 'results' || app.phase === 'leaderboard') {
    const reveal = app.lastReveal.get(clientId);
    if (reveal) safeSend(clientId, reveal);
  } else if (app.phase === 'final') {
    sendEnd(clientId);
  }
}

function handleAnswer(entry, msg) {
  const { clientId } = entry;
  if (!clientId || app.phase !== 'question') return;
  if (msg.qIndex !== app.game.currentQuestionIndex) return;
  let accepted = false;
  try {
    accepted = app.game.submitAnswer(clientId, msg.answer, Date.now());
  } catch (e) {
    console.warn('answer rejected', e.message);
  }
  if (accepted) {
    safeSend(clientId, protocol.answered());
    $('answered-count').textContent = app.game.answeredCount();
    checkQuestionDone();
  }
}

// ---------------------------------------------------------------- game flow

function startGame() {
  if (app.game.players.size === 0) {
    showError('lobby-error', 'Wait for at least one player to join first.');
    return;
  }
  showError('lobby-error', '');
  clearInterval(app.lobbyMusic);
  app.game.start();
  nextQuestion(true);
}

function sendQuestion(clientId, p) {
  safeSend(clientId, protocol.question(p.qIndex, p.total, p.type, p.text, p.image, p.timeLimit, p.multi, p.answers));
}

function nextQuestion(first = false) {
  if (!first) app.game.nextQuestion();
  if (app.game.isGameOver()) {
    showFinalScreen();
    return;
  }

  const { hostView, playerPayloads } = app.game.startQuestion(Date.now());
  app.lastReveal.clear();
  showScreen('question');
  setPauseButton(false);

  $('q-number').textContent = hostView.qIndex + 1;
  $('q-total').textContent = hostView.total;
  $('answered-count').textContent = 0;
  $('question-text').textContent = hostView.text;
  const img = $('question-image');
  if (hostView.image) {
    img.src = hostView.image;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }

  $('per-player-note').classList.toggle('hidden', !hostView.perPlayer || hostView.type === 'type');
  const tiles = $('answer-tiles');
  tiles.replaceChildren();
  if (hostView.type === 'type') {
    tiles.append(el('p', { class: 'type-note', text: 'Students are typing their answers…' }));
  } else if (hostView.perPlayer) {
    hostView.tiles.forEach(t => tiles.append(el('div', { class: 'answer-tile answer-tile--plain', text: t.text })));
  } else {
    hostView.tiles.forEach(t => tiles.append(tileNode(t)));
  }
  renderPlayers();

  playerPayloads.forEach((payload, clientId) => sendQuestion(clientId, payload));
  startTimer(hostView.timeLimit * 1000);
}

function tileNode(t) {
  return el('div', { class: `answer-tile answer-tile--${t.color}`, 'data-shape': t.shape },
    el('span', { class: `shape shape--${t.shape}`, 'aria-hidden': 'true' }),
    el('span', { class: 'tile-text', text: t.text }));
}

function startTimer(durationMs) {
  clearInterval(app.timer);
  let lastTick = -1;
  const ring = $('countdown-ring');
  const update = () => {
    if (app.phase !== 'question') return;
    if (app.game.isPaused()) {
      ring.textContent = '⏸';
      return;
    }
    const remaining = Math.max(0, durationMs - app.game.elapsedAt(Date.now()));
    const secs = Math.ceil(remaining / 1000);
    ring.textContent = secs;
    if (secs <= 5 && secs > 0 && secs !== lastTick) {
      lastTick = secs;
      safe(playCountdownTick);
    }
    if (remaining <= 0) finishQuestion();
  };
  update();
  app.timer = setInterval(update, 200);
}

function checkQuestionDone() {
  if (app.phase === 'question' && !app.game.isPaused() && app.game.isQuestionDone(Date.now())) finishQuestion();
}

function togglePause() {
  if (app.phase !== 'question') return;
  const now = Date.now();
  if (app.game.isPaused()) {
    app.game.resume(now);
    broadcast(protocol.paused(false));
    setPauseButton(false);
  } else if (app.game.pause(now)) {
    broadcast(protocol.paused(true));
    setPauseButton(true);
  }
}

function setPauseButton(paused) {
  $('pause-button').textContent = paused ? 'Resume' : 'Pause';
  $('pause-button').setAttribute('aria-pressed', paused ? 'true' : 'false');
}

function skipQuestion() {
  if (app.phase === 'question') finishQuestion();
}

function finishQuestion() {
  if (app.phase !== 'question') return;
  clearInterval(app.timer);
  safe(playTimeUp);
  if (app.game.isPaused()) broadcast(protocol.paused(false));
  const results = app.game.endQuestion(Date.now());
  const summary = app.game.getQuestionSummary();

  results.forEach((r, clientId) => {
    const msg = protocol.reveal(r.correct, r.points, r.score, r.streak, r.rank, r.correctIds, r.correctText);
    app.lastReveal.set(clientId, msg);
    safeSend(clientId, msg);
  });

  renderResults(summary);
  showScreen('results');
  const last = app.game.currentQuestionIndex >= app.game.questionOrder.length - 1;
  $('results-next').textContent = 'Next';
  $('leaderboard-next').textContent = last ? 'See the podium' : 'Next Question';
}

function renderResults(s) {
  $('results-question').textContent = s.text;
  const chart = $('distribution-chart');
  chart.replaceChildren();
  const extra = $('results-extra');
  extra.replaceChildren();
  const max = Math.max(1, ...s.counts.map(c => c.count));

  if (s.type === 'type') {
    extra.append(el('p', { class: 'reveal-answer', text: `Accepted answer: ${s.accepted.join(' / ')}` }));
    extra.append(el('p', { text: `${s.correctCount} of ${s.present} correct` }));
    if (s.typed?.length) {
      extra.append(el('ul', { class: 'typed-list' }, s.typed.map(t => el('li', { text: `${t.text} (${t.count})` }))));
    }
    return;
  }

  s.counts.forEach(c => {
    chart.append(el('div', { class: 'distribution-bar' },
      el('div', { class: 'bar-count', text: String(c.count) }),
      el('div', { class: 'bar-track' },
        el('div', { class: `bar-graph ${c.correct ? 'correct' : ''} ${c.color ? 'bar-' + c.color : ''}`, style: `height: ${Math.max(3, Math.round((c.count / max) * 100))}%` })),
      el('div', { class: 'bar-label' }, c.shape ? el('span', { class: `shape shape--${c.shape}`, 'aria-hidden': 'true' }) : null,
        el('span', { text: `${c.correct ? '✓ ' : ''}${c.text}` }))));
  });
  if (s.type === 'poll') extra.append(el('p', { class: 'text-muted', text: `${s.answered} of ${s.present} answered` }));
}

function nextScreen() {
  if (app.phase !== 'results') return;
  const board = $('leaderboard-list');
  board.replaceChildren();
  app.game.getLeaderboard().slice(0, 5).forEach(p => {
    board.append(el('div', { class: 'leaderboard-row' },
      el('span', { class: 'leaderboard-rank', text: String(p.rank) }),
      el('span', { class: 'leaderboard-name', text: p.name }),
      el('span', { class: 'leaderboard-score', text: String(p.score) })));
  });
  showScreen('leaderboard');
}

function sendEnd(clientId) {
  const fin = app.game.getPlayerFinal(clientId);
  if (fin) safeSend(clientId, protocol.end(fin.rank, fin.score, app.game.questionOrder.length));
}

function showFinalScreen() {
  clearInterval(app.timer);
  clearInterval(app.lobbyMusic);
  showScreen('final');
  const results = app.game.getFinalResults();
  const podium = $('podium');
  podium.replaceChildren();
  const medals = ['🥇', '🥈', '🥉'];
  results.leaderboard.slice(0, 3).forEach((player, i) => {
    podium.append(el('div', { class: `podium-place podium-rank-${i + 1}` },
      el('div', { class: 'podium-medal', 'aria-hidden': 'true', text: medals[i] }),
      el('div', { class: 'podium-name', text: `${player.rank}. ${player.name}` }),
      el('div', { class: 'podium-score', text: String(player.score) })));
  });

  const stats = app.game.getQuestionStats();
  const stat = $('final-stats');
  stat.replaceChildren();
  if (stats.length) {
    stat.append(el('h3', { text: 'How did the class do?' }),
      el('table', { class: 'stats-table', id: 'stats-table' },
        el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Question' }), el('th', { text: '% correct' }))),
        el('tbody', {}, stats.map(s => el('tr', {},
          el('td', { text: String(s.pos + 1) }),
          el('td', { text: s.text }),
          el('td', { text: s.pct === null ? '–' : `${s.pct}%` }))))));
  }

  app.clientConn.forEach((_, clientId) => sendEnd(clientId));
  safe(playPodiumFanfare);
}

function endGame() {
  if (app.phase === 'quiz-select' || app.phase === 'settings') return;
  if (!confirm('End the game now? Players will see their final scores.')) return;
  clearInterval(app.timer);
  if (app.game.gameStarted) {
    // Count the question in progress so scores and the CSV are complete.
    if (app.phase === 'question') app.game.endQuestion(Date.now());
    showFinalScreen();
  } else {
    app.host?.close();
    location.href = 'index.html';
  }
}

function downloadResults() {
  const csv = '﻿' + app.game.getResultsCSV();
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `khawho-results-${app.pin}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

window.hostApp = {
  createGame,
  backToQuizzes,
  copyJoinUrl,
  toggleLock,
  toggleMute,
  startGame,
  nextQuestion: () => nextQuestion(false),
  skipQuestion,
  togglePause,
  endGame,
  downloadResults,
  nextScreen,
};

initApp();
