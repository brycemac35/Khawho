/**
 * Player flow module - manages PIN entry, nickname, answering, and results
 */

import { joinGame } from './transport/index.js';
import * as protocol from './protocol.js';
import { playCorrect, playWrong } from './sound.js';

// Global app state
const app = {
  // Connection
  pin: null,
  clientId: null,
  connection: null,
  playerName: null,
  currentScore: 0,
  currentStreak: 0,
  currentRank: 0,

  // Game state
  currentQuestion: null,
  currentAnswer: null,
  answered: false,
  reconnecting: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 30, // ~30 seconds with 1s delay

  // UI state
  currentScreen: 'pin-entry',
  screens: {},
};

// Get client ID from localStorage or generate one
function getClientId() {
  let id = localStorage.getItem('khawho.clientId');
  if (!id) {
    // Generate a random-ish ID
    id = 'player-' + Math.random().toString(36).substring(2, 10);
  }
  return id;
}

// Initialize
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  console.log('Initializing player app');

  // Cache screens
  app.screens = {
    pinEntry: document.getElementById('screen-pin-entry'),
    nickname: document.getElementById('screen-nickname'),
    waiting: document.getElementById('screen-waiting'),
    question: document.getElementById('screen-question'),
    reveal: document.getElementById('screen-reveal'),
    final: document.getElementById('screen-final'),
    kicked: document.getElementById('screen-kicked'),
    reconnecting: document.getElementById('screen-reconnecting'),
  };

  // Check if PIN is in URL
  const params = new URLSearchParams(location.search);
  const urlPin = params.get('pin');
  const via = params.get('via') || 'local';

  if (urlPin) {
    document.getElementById('pin-input').value = urlPin;
    app.pin = urlPin;
    localStorage.setItem('khawho.lastPin', urlPin);
  }

  // Set up keyboard handlers
  document.getElementById('pin-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinPlayerGame();
  });

  document.getElementById('nickname-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitNickname();
  });

  // Get stored client ID
  app.clientId = getClientId();

  showScreen('pinEntry');
}

function showScreen(screenName) {
  Object.values(app.screens).forEach(screen => screen.classList.add('hidden'));
  if (app.screens[screenName]) {
    app.screens[screenName].classList.remove('hidden');
  }
  app.currentScreen = screenName;
}

async function joinPlayerGame() {
  const pin = document.getElementById('pin-input').value.trim();
  if (!pin || pin.length !== 6) {
    showError('pin-entry', 'PIN must be 6 digits');
    return;
  }

  const params = new URLSearchParams(location.search);
  const via = params.get('via') || 'local';

  try {
    document.getElementById('join-error').classList.add('hidden');

    app.connection = await joinGame(via, pin, { timeoutMs: 10000 });
    app.pin = pin;
    localStorage.setItem('khawho.lastPin', pin);

    // Save connection ID for reconnection
    localStorage.setItem(`khawho.clientId.${pin}`, app.clientId);

    // Listen for messages from host
    app.connection.onMessage(handleHostMessage);
    app.connection.onClose(() => {
      if (!app.reconnecting) {
        attemptReconnect();
      }
    });

    showScreen('nickname');
  } catch (error) {
    showError('pin-entry', `Failed to join: ${error.message}`);
  }
}

function submitNickname() {
  const name = document.getElementById('nickname-input').value.trim();
  if (!name) {
    showError('nickname', 'Name is required');
    return;
  }

  if (name.length > 15) {
    showError('nickname', 'Name must be 15 characters or less');
    return;
  }

  app.playerName = name;

  // Send join message to host
  app.connection.send(protocol.join(name, app.clientId));

  // Show waiting screen
  showScreen('waiting');
  document.getElementById('waiting-name').textContent = name;
}

function handleHostMessage(msg) {
  console.log('Host message:', msg);

  if (msg.t === protocol.MSG_WELCOME) {
    // Accepted
    app.playerName = msg.name;
    app.currentScore = msg.score;
    showScreen('waiting');
    document.getElementById('waiting-name').textContent = msg.name;
  } else if (msg.t === protocol.MSG_REJECT) {
    showError('nickname', msg.reason);
  } else if (msg.t === protocol.MSG_LOBBY) {
    showScreen('waiting');
  } else if (msg.t === protocol.MSG_QUESTION) {
    showQuestion(msg);
  } else if (msg.t === protocol.MSG_ANSWERED) {
    // Answer acknowledged
    app.answered = true;
  } else if (msg.t === protocol.MSG_REVEAL) {
    showReveal(msg);
  } else if (msg.t === protocol.MSG_END) {
    showFinal(msg);
  } else if (msg.t === protocol.MSG_KICKED) {
    showScreen('kicked');
  } else if (msg.t === protocol.MSG_PAUSED) {
    // Handle pause
  }
}

function showQuestion(msg) {
  showScreen('question');
  app.currentQuestion = msg;
  app.currentAnswer = null;
  app.answered = false;

  // Display question text
  document.getElementById('player-question-text').textContent = msg.text;

  if (msg.image) {
    const img = document.getElementById('player-question-image');
    img.src = msg.image;
    img.classList.remove('hidden');
  } else {
    document.getElementById('player-question-image').classList.add('hidden');
  }

  const container = document.getElementById('answer-container');
  container.innerHTML = '';

  if (msg.type === 'type') {
    // Text input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type your answer';
    input.id = 'type-answer-input';
    input.className = 'answer-input';
    container.appendChild(input);
    document.getElementById('submit-section').classList.remove('hidden');
  } else if (msg.type === 'poll' || msg.type === 'mc' || msg.type === 'tf') {
    // Answer tiles
    const grid = document.createElement('div');
    grid.className = 'answer-grid';

    const selectedIds = new Set();

    msg.answers.forEach((ans, i) => {
      const tile = document.createElement('button');
      tile.className = 'answer-tile';

      // Add shape and color if present
      if (ans.shape && ans.color) {
        const shapeDiv = document.createElement('div');
        shapeDiv.className = `shape shape--${ans.shape}`;
        shapeDiv.style.backgroundColor = getColorCss(ans.color);
        tile.appendChild(shapeDiv);
      }

      const textDiv = document.createElement('div');
      textDiv.textContent = ans.text;
      tile.appendChild(textDiv);

      tile.onclick = () => {
        if (app.answered) return;

        // Toggle selection
        if (msg.multi) {
          tile.classList.toggle('selected');
          if (tile.classList.contains('selected')) {
            selectedIds.add(ans.id);
          } else {
            selectedIds.delete(ans.id);
          }
        } else {
          // Single select
          grid.querySelectorAll('.answer-tile').forEach(t => t.classList.remove('selected'));
          tile.classList.add('selected');
          selectedIds.clear();
          selectedIds.add(ans.id);

          // Auto-submit on single select (non-multi)
          if (!msg.multi) {
            setTimeout(submitAnswer, 300);
          }
        }
      };

      tile.style.backgroundColor = getColorCss(ans.color || 'red');

      grid.appendChild(tile);
    });

    container.appendChild(grid);

    if (msg.multi) {
      document.getElementById('submit-section').classList.remove('hidden');
    } else {
      document.getElementById('submit-section').classList.add('hidden');
    }
  }
}

function getColorCss(colorName) {
  const colors = {
    red: 'var(--color-red)',
    blue: 'var(--color-blue)',
    yellow: 'var(--color-yellow)',
    green: 'var(--color-green)',
  };
  return colors[colorName] || colorName;
}

function submitAnswer() {
  if (app.answered || !app.currentQuestion) return;

  if (app.currentQuestion.type === 'type') {
    const input = document.getElementById('type-answer-input');
    app.currentAnswer = input.value;
  } else {
    const selectedTiles = document.querySelectorAll('.answer-tile.selected');
    app.currentAnswer = Array.from(selectedTiles).map(tile => {
      // Find the answer ID by matching the tile
      const ansText = tile.textContent.trim();
      return app.currentQuestion.answers.find(ans => ans.text === ansText)?.id;
    }).filter(id => id);
  }

  // Send answer to host
  app.connection.send(protocol.answer(app.currentQuestion.qIndex, app.currentAnswer));
  app.answered = true;

  // Show locked message
  const container = document.getElementById('answer-container');
  container.innerHTML = '<div class="text-center" style="color: white; font-size: 1.5rem;">Answer locked in</div>';
}

function showReveal(msg) {
  showScreen('reveal');

  const resultDiv = document.getElementById('reveal-result');
  if (msg.correct === true) {
    resultDiv.textContent = '✓ Correct!';
    resultDiv.className = 'reveal-message correct';
    playCorrect();
  } else if (msg.correct === false) {
    resultDiv.textContent = '✗ Wrong';
    resultDiv.className = 'reveal-message wrong';
    playWrong();
  } else {
    resultDiv.textContent = '●';
    resultDiv.className = 'reveal-message';
  }

  document.getElementById('reveal-points').innerHTML = msg.points > 0
    ? `<div class="reveal-points">+${msg.points}</div>`
    : '';

  document.getElementById('reveal-streak').textContent = msg.streak > 0
    ? `Streak: ${msg.streak} 🔥`
    : '';

  document.getElementById('reveal-rank').textContent = `Rank: #${msg.rank}`;

  app.currentScore = msg.score;
  app.currentStreak = msg.streak;
  app.currentRank = msg.rank;
}

function showFinal(msg) {
  showScreen('final');

  document.getElementById('final-rank').innerHTML = `
    <h2>You placed <strong>#${msg.rank}</strong></h2>
  `;

  document.getElementById('final-score').innerHTML = `
    <h3>Final Score: <strong>${msg.score}</strong></h3>
  `;
}

function showError(screenName, message) {
  const errorEl = document.getElementById(`${screenName}-error`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  } else {
    alert(message);
  }
}

async function attemptReconnect() {
  if (app.reconnecting || !app.pin || app.reconnectAttempts >= app.maxReconnectAttempts) {
    showScreen('reconnecting');
    document.getElementById('reconnect-status').textContent = 'Connection lost. Tap to try again.';
    return;
  }

  app.reconnecting = true;
  app.reconnectAttempts++;
  showScreen('reconnecting');

  try {
    const params = new URLSearchParams(location.search);
    const via = params.get('via') || 'local';

    app.connection = await joinGame(via, app.pin, { timeoutMs: 2000 });

    // Restore listener
    app.connection.onMessage(handleHostMessage);
    app.connection.onClose(() => attemptReconnect());

    // Send rejoin
    app.connection.send(protocol.join(app.playerName, app.clientId));

    app.reconnecting = false;
    app.reconnectAttempts = 0;
    showScreen('waiting');
  } catch (e) {
    console.log('Reconnect attempt failed, will retry...');
    setTimeout(attemptReconnect, 1000);
  }
}

// Export for HTML
window.playerApp = {
  joinGame: joinPlayerGame,
  submitNickname,
  submitAnswer,
};
