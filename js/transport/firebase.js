/**
 * Firebase Realtime Database transport — fallback when WebRTC is blocked
 * Contract: createHost(opts) -> host; joinGame(pin, opts) -> conn
 *
 * Data layout (see firebase-rules.json, which must match every operation here):
 *   games/<pin>/meta                         { createdAt, hostId }   (host)
 *   games/<pin>/players/<connId>             { joinedAt }            (player announces itself)
 *   games/<pin>/toHost/<connId>/<pushKey>    { d: "<json>" }         (player -> host)
 *   games/<pin>/toPlayer/<connId>/<pushKey>  { d: "<json>" }         (host -> player)
 *
 * Messages are stored as a JSON string in `d` because the Realtime Database
 * drops empty arrays / nulls and forbids some characters in object keys.
 * Every message is deleted by its receiver as soon as it has been consumed.
 */

import { FIREBASE_CONFIG } from '../config.js';
import { randomId } from '../rng.js';

const FIREBASE_VERSION = '10.9.0';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`;
const FIREBASE_DB_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database-compat.js`;

const STALE_META_MS = 6 * 60 * 60 * 1000;
const NOT_SET_UP = 'Backup mode is not set up yet — see the README';

let firebaseLoadPromise = null;
let firebaseApp = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load the Backup mode library — check your connection'));
    document.head.appendChild(s);
  });
}

/**
 * Load the Firebase compat SDK (classic scripts) if not already loaded.
 */
function loadFirebase() {
  if (window.firebase && window.firebase.initializeApp && window.firebase.database) {
    return Promise.resolve();
  }
  if (!firebaseLoadPromise) {
    firebaseLoadPromise = (async () => {
      await loadScript(FIREBASE_APP_URL);
      await loadScript(FIREBASE_DB_URL);
      if (!window.firebase || !window.firebase.database) {
        throw new Error('Failed to load the Backup mode library');
      }
    })().catch((err) => {
      firebaseLoadPromise = null; // allow retry
      throw err;
    });
  }
  return firebaseLoadPromise;
}

/**
 * Get or initialize the Firebase app (one per page).
 */
function getFirebaseApp() {
  if (!FIREBASE_CONFIG) throw new Error(NOT_SET_UP);
  if (firebaseApp) return firebaseApp;
  try {
    firebaseApp = window.firebase.initializeApp(FIREBASE_CONFIG, `khawho-${randomId()}`);
    return firebaseApp;
  } catch (err) {
    throw new Error(`Failed to initialize Firebase: ${err.message}`);
  }
}

async function getDb() {
  if (!FIREBASE_CONFIG) throw new Error(NOT_SET_UP);
  await loadFirebase();
  return getFirebaseApp().database();
}

function encode(obj) {
  return { d: JSON.stringify(obj) };
}

function decode(snapshot) {
  const val = snapshot.val();
  if (!val || typeof val.d !== 'string') return null;
  try {
    const obj = JSON.parse(val.d);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** Convert Firebase errors into plain-language messages. */
function friendly(err, fallback) {
  const code = err && err.code ? String(err.code) : '';
  if (/permission/i.test(code) || /permission_denied/i.test(String(err && err.message))) {
    return new Error('Backup mode was refused by the server — the database rules may be wrong (see the README)');
  }
  return err instanceof Error && err.message ? err : new Error(fallback);
}

const PIN_RE = /^[0-9]{6}$/;

/**
 * A connection object shared by host side and player side.
 * `incoming` is the ref messages arrive on; `outgoing` is where send() pushes.
 * `cleanup` runs once on close (removes data); `onDetach` stops listeners.
 */
function createConnection({ id, incoming, outgoing, cleanup }) {
  let closed = false;
  let onMessageCb = null;
  let onCloseCb = null;
  const buffer = [];

  const listener = incoming.on(
    'child_added',
    (snap) => {
      if (closed) return;
      const msg = decode(snap);
      // Consume-and-delete, whether or not it could be decoded.
      snap.ref.remove().catch(() => {});
      if (!msg) return;
      if (onMessageCb) onMessageCb(msg);
      else buffer.push(msg);
    },
    () => {} // listen cancelled (permission denied etc.): nothing to do
  );

  const conn = {
    id,
    send(obj) {
      if (closed) return;
      outgoing.push(encode(obj)).catch(() => {});
    },
    onMessage(cb) {
      onMessageCb = cb;
      while (buffer.length > 0 && onMessageCb === cb) cb(buffer.shift());
    },
    onClose(cb) {
      onCloseCb = cb;
    },
    close() {
      conn._finish(true);
    },
    /** @private Close this side; `local` = removes shared data too. */
    _finish(local) {
      if (closed) return;
      closed = true;
      incoming.off('child_added', listener);
      if (local) cleanup();
      if (onCloseCb) {
        const cb = onCloseCb;
        onCloseCb = null;
        cb();
      }
    },
    get closed() {
      return closed;
    },
  };
  return conn;
}

/**
 * Create a host on the given PIN using Firebase Realtime Database.
 * @param {object} opts - { pin: string }
 * @returns {Promise<Host>}
 */
export async function createHost(opts) {
  const { pin } = opts || {};
  if (!pin) throw new Error('pin required');
  if (!PIN_RE.test(String(pin))) throw new Error('PIN must be 6 digits');

  const db = await getDb();
  const gameRef = db.ref(`games/${pin}`);
  const metaRef = gameRef.child('meta');
  const playersRef = gameRef.child('players');
  const toHostRef = gameRef.child('toHost');
  const toPlayerRef = gameRef.child('toPlayer');
  const hostId = randomId();

  // The four per-game nodes. Each is removed separately because the rules
  // grant write on these nodes, not on games/<pin> itself.
  const gameNodes = [metaRef, playersRef, toHostRef, toPlayerRef];

  try {
    // Is the PIN already in use by a recent game?
    const existing = await metaRef.get();
    if (existing.exists()) {
      const createdAt = Number(existing.val() && existing.val().createdAt);
      if (Number.isFinite(createdAt) && Date.now() - createdAt < STALE_META_MS) {
        throw new Error('That game PIN is already in use');
      }
      // Stale leftovers from a crashed host: clear them out first.
      await Promise.all(gameNodes.map((r) => r.remove()));
    }

    // Claim the PIN atomically (rules only allow creating meta when absent).
    const result = await metaRef.transaction((current) => {
      if (current !== null) return undefined; // abort: someone else claimed it
      return { createdAt: window.firebase.database.ServerValue.TIMESTAMP, hostId };
    }, undefined, false);
    if (!result.committed) throw new Error('That game PIN is already in use');
  } catch (err) {
    throw friendly(err, 'Could not reach the Backup server');
  }

  // If the host vanishes (tab closed, network lost) the server cleans up.
  gameNodes.forEach((r) => r.onDisconnect().remove());

  let closed = false;
  let onConnection = null;
  const connections = new Map();

  const delivered = new Set();
  const deliver = (conn) => {
    if (!onConnection || delivered.has(conn.id)) return;
    delivered.add(conn.id);
    onConnection(conn);
  };

  const forget = (connId) => {
    const c = connections.get(connId);
    if (c) {
      connections.delete(connId);
      c._finish(false);
    }
  };

  playersRef.on(
    'child_added',
    (snap) => {
      if (closed) return;
      const connId = snap.key;
      if (connections.has(connId)) return;
      const conn = createConnection({
        id: connId,
        incoming: toHostRef.child(connId),
        outgoing: toPlayerRef.child(connId),
        cleanup: () => {
          connections.delete(connId);
          playersRef.child(connId).remove().catch(() => {});
          toHostRef.child(connId).remove().catch(() => {});
          toPlayerRef.child(connId).remove().catch(() => {});
        },
      });
      connections.set(connId, conn);
      deliver(conn);
    },
    () => {}
  );

  // Player removed its announcement (left / disconnected): close its connection.
  playersRef.on('child_removed', (snap) => {
    if (closed) return;
    const connId = snap.key;
    forget(connId);
    toHostRef.child(connId).remove().catch(() => {});
    toPlayerRef.child(connId).remove().catch(() => {});
  });

  return {
    pin,
    onConnection(cb) {
      onConnection = cb;
      // Deliver connections that arrived before the callback was registered.
      connections.forEach((c) => deliver(c));
    },
    close() {
      if (closed) return;
      closed = true;
      playersRef.off();
      const open = Array.from(connections.values());
      connections.clear();
      open.forEach((c) => c._finish(false));
      gameNodes.forEach((r) => r.onDisconnect().cancel().catch(() => {}));
      gameNodes.forEach((r) => r.remove().catch(() => {}));
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
  if (!PIN_RE.test(String(pin))) throw new Error('Game not found — check the PIN');

  const db = await getDb();
  const gameRef = db.ref(`games/${pin}`);
  const metaRef = gameRef.child('meta');
  const connId = randomId();
  const playerRef = gameRef.child('players').child(connId);
  const toHostRef = gameRef.child('toHost').child(connId);
  const toPlayerRef = gameRef.child('toPlayer').child(connId);

  // 1. The host must exist before we announce ourselves.
  let timer;
  try {
    const snap = await Promise.race([
      metaRef.get(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Could not reach the game — check your connection')), timeoutMs);
      }),
    ]);
    if (!snap.exists()) throw new Error('Game not found — check the PIN');
  } catch (err) {
    throw friendly(err, 'Could not reach the game — check your connection');
  } finally {
    clearTimeout(timer);
  }

  // 2. Build the connection (starts listening on toPlayer/<connId>) before announcing,
  //    so nothing the host sends right after it sees us is missed.
  const conn = createConnection({
    id: connId,
    incoming: toPlayerRef,
    outgoing: toHostRef,
    cleanup: () => {
      playerRef.remove().catch(() => {});
      toHostRef.remove().catch(() => {});
      toPlayerRef.remove().catch(() => {});
    },
  });

  // If this tab goes away, the server removes everything that belongs to us.
  try {
    await Promise.all([
      playerRef.onDisconnect().remove(),
      toHostRef.onDisconnect().remove(),
      toPlayerRef.onDisconnect().remove(),
    ]);
    await playerRef.set({ joinedAt: window.firebase.database.ServerValue.TIMESTAMP });
  } catch (err) {
    conn._finish(true);
    throw friendly(err, 'Could not join the game');
  }

  // 3. Detect the host closing us (kick / host left): our announcement or the
  //    game's meta disappears.
  let watching = true;
  const stopWatching = () => {
    if (!watching) return;
    watching = false;
    playerRef.off('value', onPlayer);
    metaRef.off('value', onMeta);
  };
  const onPlayer = (snap) => {
    if (!snap.exists() && !conn.closed) {
      stopWatching();
      conn._finish(true);
    }
  };
  const onMeta = (snap) => {
    if (!snap.exists() && !conn.closed) {
      stopWatching();
      conn._finish(true);
    }
  };
  playerRef.on('value', onPlayer, () => {});
  metaRef.on('value', onMeta, () => {});

  const baseClose = conn.close;
  conn.close = () => {
    stopWatching();
    baseClose();
  };

  return conn;
}
