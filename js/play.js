/**
 * Player flow: PIN -> nickname -> wait -> answer -> reveal -> final.
 * The player never learns which answer is correct until the host sends the reveal.
 */

import { joinGame } from './transport/index.js';
import * as protocol from './protocol.js';
import { randomId } from './rng.js';
import { playCorrect, playWrong } from './sound.js';

const SESSION_KEY = 'khawho.session';
const CLIENT_KEY = 'khawho.clientId';
const MAX_RECONNECTS = 40;

const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
if (debug) window.__khawhoLog = [];

const app = {
  pin: null,
  via: params.get('via') || 'peerjs',
  clientId: null,
  conn: null,
  name: null,
  joined: false, // host sent a welcome on this connection
  closing: false, // deliberate close (kicked / game over): do not reconnect
  reconnects: 0,
  question: null,
  selected: new Set(),
  answered: false,
  screens: {},
};

const $ = (id) => document.getElementById(id);

/** Per-tab id so a refresh rejoins as the same player (and tabs stay distinct). */
function getClientId() {
  let id = sessionStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = randomId(8);
    sessionStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pin: app.pin, via: app.via, name: app.name }));
}

function showScreen(name) {
  Object.entries(app.screens).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
  app.screen = name;
}

function showError(id, message) {
  const box = $(id);
  box.textContent = message || '';
  box.classList.toggle('hidden', !message);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  children.flat().forEach(c => { if (c !== null && c !== undefined) node.append(c); });
  return node;
}

function initApp() {
  app.screens = {
    'pin-entry': $('screen-pin-entry'),
    nickname: $('screen-nickname'),
    waiting: $('screen-waiting'),
    question: $('screen-question'),
    reveal: $('screen-reveal'),
    final: $('screen-final'),
    kicked: $('screen-kicked'),
    reconnecting: $('screen-reconnecting'),
  };
  app.clientId = getClientId();

  $('pin-form').addEventListener('submit', (e) => { e.preventDefault(); joinByPin(); });
  $('nickname-form').addEventListener('submit', (e) => { e.preventDefault(); submitNickname(); });

  const urlPin = params.get('pin');
  const session = loadSession();
  showScreen('pin-entry');

  if (session && (!urlPin || urlPin === session.pin)) {
    // Refresh or lost page: quietly rejoin the same game with the same name.
    app.pin = session.pin;
    app.via = session.via || app.via;
    app.name = session.name;
    $('pin-input').value = session.pin;
    reconnect(true);
    return;
  }
  if (urlPin) $('pin-input').value = urlPin.replace(/\D/g, '').slice(0, 6);
  $('pin-input').focus();
}

async function joinByPin() {
  const pin = $('pin-input').value.trim();
  if (!/^\d{6}$/.test(pin)) {
    showError('pin-entry-error', 'The PIN is 6 numbers. Check the screen at the front of the room.');
    return;
  }
  showError('pin-entry-error', '');
  const button = $('pin-submit');
  button.disabled = true;
  button.textContent = 'Joining…';
  try {
    app.pin = pin;
    app.conn = await joinGame(app.via, pin, { timeoutMs: 10000 });
    attach(app.conn);
    showScreen('nickname');
    $('nickname-input').focus();
  } catch (error) {
    showError('pin-entry-error', /not found/i.test(error.message)
      ? 'No game found with that PIN. Check the number and try again.'
      : `Could not join: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Join';
  }
}

function attach(conn) {
  conn.onMessage(handleHostMessage);
  conn.onClose(() => {
    if (conn !== app.conn || app.closing) return;
    reconnect(false);
  });
}

function submitNickname() {
  const name = $('nickname-input').value.trim();
  if (!name) {
    showError('nickname-error', 'Please type a name.');
    return;
  }
  if (name.length > 15) {
    showError('nickname-error', 'Names can be up to 15 letters.');
    return;
  }
  showError('nickname-error', '');
  app.name = name;
  $('nickname-submit').disabled = true;
  app.conn.send(protocol.join(name, app.clientId));
}

function handleHostMessage(msg) {
  if (debug) window.__khawhoLog.push(JSON.parse(JSON.stringify(msg)));
  switch (msg.t) {
    case protocol.MSG_WELCOME:
      app.joined = true;
      app.reconnects = 0;
      app.name = msg.name;
      saveSession();
      $('nickname-submit').disabled = false;
      $('waiting-name').textContent = msg.name;
      if (app.screen !== 'question' && app.screen !== 'reveal') showScreen('waiting');
      break;
    case protocol.MSG_REJECT:
      $('nickname-submit').disabled = false;
      if (app.screen === 'reconnecting' || app.screen === 'pin-entry') {
        sessionStorage.removeItem(SESSION_KEY);
        showScreen('nickname');
      }
      showError('nickname-error', msg.reason || 'Could not join.');
      break;
    case protocol.MSG_LOBBY:
      showScreen('waiting');
      break;
    case protocol.MSG_QUESTION:
      showQuestion(msg);
      break;
    case protocol.MSG_ANSWERED:
      lockAnswer();
      break;
    case protocol.MSG_REVEAL:
      showReveal(msg);
      break;
    case protocol.MSG_END:
      app.closing = true;
      sessionStorage.removeItem(SESSION_KEY);
      showFinal(msg);
      break;
    case protocol.MSG_KICKED:
      app.closing = true;
      sessionStorage.removeItem(SESSION_KEY);
      showScreen('kicked');
      break;
    case protocol.MSG_PAUSED:
      $('pause-overlay').classList.toggle('hidden', !msg.paused);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- questions

function showQuestion(msg) {
  app.question = msg;
  app.selected = new Set();
  app.answered = false;
  $('pause-overlay').classList.add('hidden');
  $('locked-message').classList.add('hidden');
  showScreen('question');

  $('player-question-text').textContent = msg.text;
  const img = $('player-question-image');
  if (msg.image) {
    img.src = msg.image;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }

  const container = $('answer-container');
  container.replaceChildren();
  const submitSection = $('submit-section');

  if (msg.type === 'type') {
    const input = el('input', {
      type: 'text', id: 'type-answer-input', class: 'answer-input', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer', placeholder: 'Type your answer',
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAnswer(); });
    container.append(input);
    submitSection.classList.remove('hidden');
    input.focus();
    return;
  }

  const grid = el('div', { class: `answer-grid answer-grid--${msg.answers.length}` });
  msg.answers.forEach(ans => {
    const tile = el('button', {
      type: 'button',
      class: `answer-tile answer-tile--${ans.color}`,
      'data-id': ans.id,
      'data-shape': ans.shape,
      'aria-pressed': 'false',
    },
    el('span', { class: `shape shape--${ans.shape}`, 'aria-hidden': 'true' }),
    el('span', { class: 'tile-text', text: ans.text }));
    tile.addEventListener('click', () => onTile(tile, ans.id, msg.multi));
    grid.append(tile);
  });
  container.append(grid);
  submitSection.classList.toggle('hidden', !msg.multi);
  $('submit-button').disabled = msg.multi;
}

function onTile(tile, id, multi) {
  if (app.answered) return;
  if (multi) {
    const on = !app.selected.has(id);
    if (on) app.selected.add(id); else app.selected.delete(id);
    tile.classList.toggle('selected', on);
    tile.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('submit-button').disabled = app.selected.size === 0;
  } else {
    app.selected = new Set([id]);
    tile.classList.add('selected');
    tile.setAttribute('aria-pressed', 'true');
    submitAnswer();
  }
}

function submitAnswer() {
  const q = app.question;
  if (app.answered || !q || !app.conn) return;
  let answer;
  if (q.type === 'type') {
    answer = $('type-answer-input').value;
    if (!answer.trim()) return;
  } else {
    answer = [...app.selected];
    if (answer.length === 0) return;
  }
  app.conn.send(protocol.answer(q.qIndex, answer));
  lockAnswer();
}

function lockAnswer() {
  if (!app.question || app.screen !== 'question') return;
  app.answered = true;
  document.querySelectorAll('#answer-container button, #answer-container input').forEach(n => { n.disabled = true; });
  $('submit-section').classList.add('hidden');
  $('locked-message').classList.remove('hidden');
}

// ---------------------------------------------------------------- reveal / end

function showReveal(msg) {
  showScreen('reveal');
  const result = $('reveal-result');
  if (msg.correct === true) {
    result.textContent = '✓ Correct!';
    result.className = 'reveal-message correct';
    safe(playCorrect);
  } else if (msg.correct === false) {
    result.textContent = '✗ Not quite';
    result.className = 'reveal-message wrong';
    safe(playWrong);
  } else {
    result.textContent = 'Thanks for answering!';
    result.className = 'reveal-message';
  }

  $('reveal-correct').textContent = msg.correct === false && msg.correctText?.length
    ? `Correct answer: ${msg.correctText.join(' and ')}`
    : '';
  const points = $('reveal-points');
  points.replaceChildren();
  if (msg.points > 0) points.append(el('div', { class: 'reveal-points', text: `+${msg.points}` }));
  $('reveal-streak').textContent = msg.streak > 1 ? `Streak: ${msg.streak} 🔥` : '';
  $('reveal-rank').textContent = `Rank: #${msg.rank}`;
  $('reveal-score').textContent = `Score: ${msg.score}`;
}

function safe(fn) {
  try { fn(); } catch { /* sound is optional */ }
}

function showFinal(msg) {
  showScreen('final');
  $('final-rank').replaceChildren(el('h2', {}, 'You placed ', el('strong', { text: `#${msg.rank}` })));
  $('final-score').replaceChildren(el('h3', {}, 'Final score: ', el('strong', { text: String(msg.score) })));
}

// ---------------------------------------------------------------- reconnect

async function reconnect(initial) {
  if (!app.pin || app.closing) return;
  showScreen('reconnecting');
  $('reconnect-button').classList.add('hidden');
  $('reconnect-status').textContent = initial ? 'Rejoining your game…' : 'Connection lost. Trying to get you back in…';

  while (!app.closing && app.reconnects < MAX_RECONNECTS) {
    app.reconnects++;
    try {
      const conn = await joinGame(app.via, app.pin, { timeoutMs: 4000 });
      app.conn = conn;
      app.joined = false;
      attach(conn);
      conn.send(protocol.join(app.name, app.clientId));
      return; // host replies with welcome (and resends the current question)
    } catch (e) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  if (!app.closing) {
    sessionStorage.removeItem(SESSION_KEY);
    $('reconnect-status').textContent = initial
      ? 'That game is no longer running.'
      : 'We could not reconnect. Check your Wi-Fi and try again.';
    app.initialFailed = !!initial;
    $('reconnect-button').textContent = initial ? 'Start over' : 'Try again';
    $('reconnect-button').classList.remove('hidden');
  }
}

function retry() {
  app.reconnects = 0;
  if (app.name && app.pin && !app.initialFailed) reconnect(false);
  else location.href = 'play.html';
}

window.playerApp = { submitAnswer, retry };

initApp();
