/**
 * Local transport using BroadcastChannel (same browser, for dev/testing).
 * Contract: createHost(opts) -> host; joinGame(pin, opts) -> conn
 */

import { randomId } from '../rng.js';

// Map of active hosts: pin -> { bc, connId }
const activeHosts = new Map();

/**
 * Create a host on the given PIN using BroadcastChannel.
 * Throws Error if another host is already listening on that PIN.
 * @param {object} opts - { pin: string }
 * @returns {Promise<Host>}
 */
export async function createHost(opts) {
  const { pin } = opts;
  if (!pin) throw new Error('pin required');

  // Check if another host is already listening by probing with a ping
  const probeCh = new BroadcastChannel(`khawho-${pin}`);
  const hostId = randomId();
  let hostFound = false;

  const pingTimeout = new Promise((resolve) => {
    const handler = (event) => {
      if (event.data?.t === 'pong' && event.data?.from !== hostId) {
        hostFound = true;
        resolve();
      }
    };
    probeCh.addEventListener('message', handler);
    // Send probe ping
    probeCh.postMessage({ t: 'ping', from: hostId });
    // Wait briefly for response
    setTimeout(() => {
      probeCh.removeEventListener('message', handler);
      resolve();
    }, 100);
  });

  await pingTimeout;
  probeCh.close();

  if (hostFound) {
    throw new Error('Another host is already using this PIN');
  }

  // Create the actual host channel
  const bc = new BroadcastChannel(`khawho-${pin}`);
  const connections = new Map();
  let closed = false;

  // Listen for join messages and incoming messages
  const messageHandler = (event) => {
    if (closed) return;

    const data = event.data;

    if (data?.t === 'ping') {
      // Another host probing; respond with pong so it knows we exist
      if (data.from !== hostId) {
        bc.postMessage({ t: 'pong', from: hostId });
      }
      return;
    }

    if (data?.t === 'hello') {
      // New player connection request
      const connId = data.connId;
      if (!connections.has(connId)) {
        const conn = createHostConnection(connId, bc);
        connections.set(connId, conn);
        // Reply with welcome so player knows connection is established
        bc.postMessage({ t: 'ack', connId });
        // Notify app of new connection
        if (onConnection) {
          onConnection(conn);
        }
      }
      return;
    }

    if (data?.connId && data?.t !== 'hello') {
      // Message from a player
      const conn = connections.get(data.connId);
      if (conn && conn._onMessage) {
        conn._onMessage(data);
      }
    }
  };

  bc.addEventListener('message', messageHandler);

  let onConnection = null;

  const host = {
    pin,
    onConnection(cb) {
      onConnection = cb;
    },
    close() {
      if (closed) return;
      closed = true;
      bc.removeEventListener('message', messageHandler);
      bc.close();
      connections.forEach((conn) => {
        if (conn._onClose) conn._onClose();
      });
      connections.clear();
    },
  };

  return host;
}

/**
 * Create a connection object for the host side.
 */
function createHostConnection(connId, bc) {
  let closed = false;

  return {
    id: connId,
    _onMessage: null,
    _onClose: null,

    send(obj) {
      if (closed) return;
      bc.postMessage({ ...obj, connId });
    },

    onMessage(cb) {
      this._onMessage = cb;
    },

    onClose(cb) {
      this._onClose = cb;
    },

    close() {
      if (closed) return;
      closed = true;
      bc.postMessage({ t: 'close', connId });
      if (this._onClose) this._onClose();
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
  const connId = randomId();

  const bc = new BroadcastChannel(`khawho-${pin}`);
  let closed = false;
  const messageBuffer = [];

  const conn = {
    id: connId,
    _onMessage: null,
    _onClose: null,

    send(obj) {
      if (closed) return;
      bc.postMessage({ ...obj, connId });
    },

    onMessage(cb) {
      this._onMessage = cb;
      // Flush any buffered messages
      while (messageBuffer.length > 0) {
        const msg = messageBuffer.shift();
        cb(msg);
      }
    },

    onClose(cb) {
      this._onClose = cb;
    },

    close() {
      if (closed) return;
      closed = true;
      bc.removeEventListener('message', messageHandler);
      bc.close();
      if (this._onClose) this._onClose();
    },
  };

  const messageHandler = (event) => {
    if (closed) return;
    const data = event.data;
    if (data?.connId === connId && data?.t !== 'ack') {
      if (conn._onMessage) {
        conn._onMessage(data);
      } else {
        // Buffer message until onMessage is registered
        messageBuffer.push(data);
      }
    }
    if (data?.t === 'close' && data?.connId === connId) {
      closed = true;
      bc.removeEventListener('message', messageHandler);
      bc.close();
      if (conn._onClose) conn._onClose();
    }
  };

  bc.addEventListener('message', messageHandler);

  // Wait for host ack
  const ackPromise = new Promise((resolve, reject) => {
    const ackHandler = (event) => {
      const data = event.data;
      if (data?.t === 'ack' && data?.connId === connId) {
        bc.removeEventListener('message', ackHandler);
        resolve();
      }
    };

    const timer = setTimeout(() => {
      bc.removeEventListener('message', ackHandler);
      reject(new Error('Game not found'));
    }, timeoutMs);

    bc.addEventListener('message', ackHandler);

    // Send hello to host
    bc.postMessage({ t: 'hello', connId });

    // Make sure timer clears on success
    const originalResolve = resolve;
    resolve = (...args) => {
      clearTimeout(timer);
      originalResolve(...args);
    };
  });

  await ackPromise;

  return conn;
}
