/**
 * Firebase Realtime Database transport — fallback when WebRTC is blocked
 * Contract: createHost(opts) -> host; joinGame(pin, opts) -> conn
 */

import { FIREBASE_CONFIG } from '../config.js';
import { randomId } from '../rng.js';

const FIREBASE_VERSION = '10.9.0';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`;
const FIREBASE_DB_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database-compat.js`;

// Global Firebase instances
let firebaseLoaded = false;
let firebaseLoadPromise = null;
let firebaseApp = null;

/**
 * Load Firebase SDK if not already loaded.
 */
async function loadFirebase() {
  if (firebaseLoaded) {
    return;
  }

  if (firebaseLoadPromise) {
    return firebaseLoadPromise;
  }

  firebaseLoadPromise = new Promise((resolve, reject) => {
    if (window.firebase && window.firebase.initializeApp) {
      firebaseLoaded = true;
      resolve();
      return;
    }

    // Load firebase-app first
    const appScript = document.createElement('script');
    appScript.src = FIREBASE_APP_URL;
    appScript.onload = () => {
      // Then load firebase-database
      const dbScript = document.createElement('script');
      dbScript.src = FIREBASE_DB_URL;
      dbScript.onload = () => {
        firebaseLoaded = true;
        resolve();
      };
      dbScript.onerror = () => {
        firebaseLoaded = false;
        firebaseLoadPromise = null;
        reject(new Error('Failed to load Firebase database library'));
      };
      document.head.appendChild(dbScript);
    };
    appScript.onerror = () => {
      firebaseLoaded = false;
      firebaseLoadPromise = null;
      reject(new Error('Failed to load Firebase library'));
    };
    document.head.appendChild(appScript);
  });

  return firebaseLoadPromise;
}

/**
 * Get or initialize Firebase app.
 */
function getFirebaseApp() {
  if (!FIREBASE_CONFIG) {
    throw new Error('Backup mode is not set up yet — see the README');
  }

  if (firebaseApp) {
    return firebaseApp;
  }

  const firebase = window.firebase;
  const appName = `khawho-${randomId()}`;

  try {
    firebaseApp = firebase.initializeApp(FIREBASE_CONFIG, appName);
    return firebaseApp;
  } catch (err) {
    throw new Error(`Failed to initialize Firebase: ${err.message}`);
  }
}

/**
 * Create a host on the given PIN using Firebase Realtime Database.
 * @param {object} opts - { pin: string }
 * @returns {Promise<Host>}
 */
export async function createHost(opts) {
  const { pin } = opts;
  if (!pin) throw new Error('pin required');

  if (!FIREBASE_CONFIG) {
    throw new Error('Backup mode is not set up yet — see the README');
  }

  await loadFirebase();

  const app = getFirebaseApp();
  const db = app.database();
  const metaPath = `games/${pin}/meta`;

  let closed = false;
  const hostId = randomId();
  const connections = new Map();
  let onConnection = null;

  try {
    // Check if game already exists
    const metaRef = db.ref(metaPath);
    const snapshot = await metaRef.get();

    if (snapshot.exists()) {
      const meta = snapshot.val();
      const createdAt = new Date(meta.createdAt).getTime();
      const now = Date.now();
      const sixHoursMs = 6 * 60 * 60 * 1000;

      if (now - createdAt < sixHoursMs) {
        throw new Error('That game PIN is already in use');
      }
    }

    // Set meta and configure onDisconnect
    await metaRef.set({
      createdAt: new Date().toISOString(),
      hostAlive: true,
      hostId,
    });

    // Clean up on disconnect
    metaRef.onDisconnect().remove();

    // Listen for new players
    const playersPath = `games/${pin}/players`;
    const playersRef = db.ref(playersPath);

    playersRef.on('child_added', (snapshot) => {
      if (closed) return;

      const connId = snapshot.key;

      // Create connection object
      const hostConn = createHostConnection(db, pin, connId);
      connections.set(connId, hostConn);

      if (onConnection) {
        onConnection(hostConn);
      }
    });

    // Listen for messages to host
    const toHostPath = `games/${pin}/toHost`;
    const toHostRef = db.ref(toHostPath);

    toHostRef.on('child_added', (snapshot) => {
      if (closed) return;

      const connId = snapshot.key;
      const messages = snapshot.val();
      const conn = connections.get(connId);

      if (conn && messages) {
        // Get individual messages
        Object.entries(messages).forEach(([pushId, msg]) => {
          if (msg && typeof msg === 'object') {
            conn._receiveMessage(msg);
            // Delete the message after reading
            db.ref(`games/${pin}/toHost/${connId}/${pushId}`).remove();
          }
        });
      }
    });
  } catch (err) {
    throw err;
  }

  const host = {
    pin,
    onConnection(cb) {
      onConnection = cb;
    },
    close() {
      if (closed) return;
      closed = true;

      // Remove all listeners on this game's paths
      db.ref(`games/${pin}/players`).off();
      db.ref(`games/${pin}/toHost`).off();

      connections.forEach((conn) => {
        if (conn._onClose) {
          conn._onClose();
        }
      });
      connections.clear();

      // Clean up game data
      const gameRef = db.ref(`games/${pin}`);
      gameRef.remove();
    },
  };

  return host;
}

/**
 * Create a connection object for the host side.
 */
function createHostConnection(db, pin, connId) {
  let closed = false;
  let onMessageCb = null;
  let onCloseCb = null;
  const messageBuffer = [];

  return {
    id: connId,
    _onMessage: null,
    _onClose: null,

    _receiveMessage(data) {
      if (closed) return;

      if (onMessageCb) {
        onMessageCb(data);
      } else {
        // Buffer message until onMessage is registered
        messageBuffer.push(data);
      }
    },

    send(obj) {
      if (closed) return;

      const pushId = randomId();
      const playerMsgRef = db.ref(`games/${pin}/toPlayer/${connId}/${pushId}`);
      playerMsgRef.set(obj);
    },

    onMessage(cb) {
      onMessageCb = cb;
      // Flush any buffered messages
      while (messageBuffer.length > 0) {
        const msg = messageBuffer.shift();
        cb(msg);
      }
    },

    onClose(cb) {
      onCloseCb = cb;
    },

    close() {
      if (closed) return;
      closed = true;

      // Remove player connection
      const playerRef = db.ref(`games/${pin}/players/${connId}`);
      playerRef.remove();

      if (onCloseCb) {
        onCloseCb();
      }
    },
  };
}

/**
 * Join a game on the given PIN.
 * @param {string} pin
 * @param {object} opts - { timeoutMs: 10000 }
 * @returns {Promise<Connection>}
 */
export async function joinGame(pin, opts = {}) {
  const { timeoutMs = 10000 } = opts;

  if (!FIREBASE_CONFIG) {
    throw new Error('Backup mode is not set up yet — see the README');
  }

  await loadFirebase();

  const app = getFirebaseApp();
  const db = app.database();
  const connId = randomId();

  let closed = false;
  let onMessageCb = null;
  let onCloseCb = null;
  const messageBuffer = [];
  let toPlayerListener = null;

  try {
    // Verify host exists
    const metaPath = `games/${pin}/meta`;
    const metaRef = db.ref(metaPath);

    const hostCheckPromise = Promise.race([
      new Promise((resolve, reject) => {
        metaRef.get().then((snapshot) => {
          if (!snapshot.exists()) {
            reject(new Error('Game not found — check the PIN'));
          } else {
            resolve();
          }
        });
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Game not found — check the PIN'));
        }, timeoutMs);
      }),
    ]);

    await hostCheckPromise;

    // Announce player
    const playerRef = db.ref(`games/${pin}/players/${connId}`);
    await playerRef.set({
      joinedAt: new Date().toISOString(),
    });

    // Set up onDisconnect to remove player
    playerRef.onDisconnect().remove();

    // Listen for messages to this player
    const toPlayerPath = `games/${pin}/toPlayer/${connId}`;
    const toPlayerRef = db.ref(toPlayerPath);

    toPlayerListener = toPlayerRef.on('child_added', (snapshot) => {
      if (closed) return;

      const pushId = snapshot.key;
      const msg = snapshot.val();

      if (msg && typeof msg === 'object') {
        if (onMessageCb) {
          onMessageCb(msg);
        } else {
          // Buffer message until onMessage is registered
          messageBuffer.push(msg);
        }

        // Delete the message after reading
        db.ref(`games/${pin}/toPlayer/${connId}/${pushId}`).remove();
      }
    });
  } catch (err) {
    throw err;
  }

  return {
    id: connId,

    send(obj) {
      if (closed) return;

      const pushId = randomId();
      const hostMsgRef = db.ref(`games/${pin}/toHost/${connId}/${pushId}`);
      hostMsgRef.set(obj);
    },

    onMessage(cb) {
      onMessageCb = cb;
      // Flush any buffered messages
      while (messageBuffer.length > 0) {
        const msg = messageBuffer.shift();
        cb(msg);
      }
    },

    onClose(cb) {
      onCloseCb = cb;
    },

    close() {
      if (closed) return;
      closed = true;

      // Remove listener
      db.ref(`games/${pin}/toPlayer/${connId}`).off();

      // Remove player connection
      const playerRef = db.ref(`games/${pin}/players/${connId}`);
      playerRef.remove();

      if (onCloseCb) {
        onCloseCb();
      }
    },
  };
}
