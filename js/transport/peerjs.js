/**
 * PeerJS cloud transport (WebRTC) — default
 * Contract: createHost(opts) -> host; joinGame(pin, opts) -> conn
 */

import { randomId } from '../rng.js';

const PEERJS_VERSION = '1.5.4';
const PEERJS_URL = `https://cdn.jsdelivr.net/npm/peerjs@${PEERJS_VERSION}/dist/peerjs.min.js`;

// Global Peer instance and load promise
let peerLibLoaded = false;
let peerLoadPromise = null;

/**
 * Load PeerJS library if not already loaded.
 * Returns a promise that resolves when Peer is available in window.
 */
async function loadPeerJS() {
  if (peerLibLoaded) {
    return;
  }

  if (peerLoadPromise) {
    return peerLoadPromise;
  }

  peerLoadPromise = new Promise((resolve, reject) => {
    if (window.Peer) {
      peerLibLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = PEERJS_URL;
    script.onload = () => {
      peerLibLoaded = true;
      resolve();
    };
    script.onerror = () => {
      peerLibLoaded = false;
      peerLoadPromise = null;
      reject(
        new Error(
          'Failed to load PeerJS library. Your school network may block it — try Backup (Firebase) mode.'
        )
      );
    };
    document.head.appendChild(script);
  });

  return peerLoadPromise;
}

/**
 * Create a host on the given PIN using PeerJS.
 * @param {object} opts - { pin: string }
 * @returns {Promise<Host>}
 */
export async function createHost(opts) {
  const { pin } = opts;
  if (!pin) throw new Error('pin required');

  await loadPeerJS();

  const hostPeerId = `khawho-${pin}`;
  let peer = null;
  let closed = false;

  try {
    peer = new window.Peer(hostPeerId, {
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
        ],
      },
    });

    // Wait for peer to be open or error
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        if (err.type === 'unavailable-id') {
          reject(new Error('That game PIN is already in use'));
        } else {
          reject(
            new Error(
              `Failed to create game host. Your school network may block it — try Backup (Firebase) mode.`
            )
          );
        }
      };
      const cleanup = () => {
        peer.removeListener('open', onOpen);
        peer.removeListener('error', onError);
      };
      peer.once('open', onOpen);
      peer.once('error', onError);

      // Timeout fallback
      setTimeout(() => {
        if (peer.open) {
          cleanup();
          resolve();
        }
      }, 5000);
    });
  } catch (err) {
    if (peer) {
      peer.destroy();
    }
    throw err;
  }

  const connections = new Map();
  let onConnection = null;

  // Listen for incoming player connections
  peer.on('connection', (conn) => {
    if (closed) {
      conn.close();
      return;
    }

    const hostConn = createHostConnection(conn);
    connections.set(conn.peer, hostConn);

    if (onConnection) {
      onConnection(hostConn);
    }
  });

  // Handle signaling server disconnects
  peer.on('disconnected', () => {
    if (!closed && peer) {
      peer.reconnect();
    }
  });

  const host = {
    pin,
    onConnection(cb) {
      onConnection = cb;
    },
    close() {
      if (closed) return;
      closed = true;
      connections.forEach((conn) => {
        if (conn._conn && !conn._conn.closed) {
          conn._conn.close();
        }
      });
      connections.clear();
      if (peer) {
        peer.destroy();
      }
    },
  };

  return host;
}

/**
 * Create a connection object for the host side.
 */
function createHostConnection(peerConn) {
  let closed = false;
  let onMessageCb = null;
  let onCloseCb = null;
  const messageBuffer = [];

  // Handle connection open
  peerConn.on('open', () => {
    // Connection established
  });

  // Handle incoming messages
  peerConn.on('data', (data) => {
    if (closed) return;

    // Filter out heartbeat messages
    if (data.__hb === 1) {
      return;
    }

    if (onMessageCb) {
      onMessageCb(data);
    } else {
      // Buffer message until onMessage is registered
      messageBuffer.push(data);
    }
  });

  // Handle connection close
  peerConn.on('close', () => {
    if (closed) return;
    closed = true;
    if (onCloseCb) {
      onCloseCb();
    }
  });

  // Handle connection errors
  peerConn.on('error', () => {
    if (!closed) {
      closed = true;
      if (onCloseCb) {
        onCloseCb();
      }
    }
  });

  // Start heartbeat monitor (close if nothing heard for 20s)
  let lastHeartbeat = Date.now();
  const heartbeatInterval = setInterval(() => {
    if (closed) {
      clearInterval(heartbeatInterval);
      return;
    }

    const now = Date.now();
    if (now - lastHeartbeat > 20000) {
      clearInterval(heartbeatInterval);
      if (!closed) {
        closed = true;
        peerConn.close();
        if (onCloseCb) {
          onCloseCb();
        }
      }
      return;
    }

    // Send heartbeat
    try {
      if (!closed && peerConn.open) {
        peerConn.send({ __hb: 1 });
      }
    } catch (e) {
      // Ignore send errors
    }
  }, 5000);

  return {
    id: peerConn.peer,
    _conn: peerConn,

    send(obj) {
      if (closed || !peerConn.open) return;
      try {
        peerConn.send(obj);
      } catch (e) {
        // Ignore send errors
      }
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
      clearInterval(heartbeatInterval);
      if (peerConn && !peerConn.closed) {
        peerConn.close();
      }
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

  await loadPeerJS();

  const hostPeerId = `khawho-${pin}`;
  const playerPeerId = randomId();

  let peer = null;
  let conn = null;

  try {
    peer = new window.Peer(playerPeerId, {
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
        ],
      },
    });

    // Wait for peer to be open
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        peer.removeListener('open', onOpen);
        resolve();
      };
      peer.once('open', onOpen);

      // Timeout fallback
      setTimeout(() => {
        if (peer.open) {
          peer.removeListener('open', onOpen);
          resolve();
        }
      }, 5000);
    });

    // Connect to host
    conn = peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'json',
    });

    // Wait for connection to open
    await Promise.race([
      new Promise((resolve) => {
        const onOpen = () => {
          conn.removeListener('open', onOpen);
          resolve();
        };
        conn.once('open', onOpen);
      }),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Game not found — check the PIN'));
        }, timeoutMs);
      }),
      new Promise((_, reject) => {
        const onError = (err) => {
          conn.removeListener('error', onError);
          if (err.type === 'peer-unavailable') {
            reject(new Error('Game not found — check the PIN'));
          } else {
            reject(
              new Error(
                'Failed to connect. Your school network may block it — try Backup (Firebase) mode.'
              )
            );
          }
        };
        conn.once('error', onError);
      }),
    ]);
  } catch (err) {
    if (conn && !conn.closed) {
      conn.close();
    }
    if (peer) {
      peer.destroy();
    }
    throw err;
  }

  let closed = false;
  let onMessageCb = null;
  let onCloseCb = null;
  const messageBuffer = [];

  // Handle heartbeat
  let lastHeartbeat = Date.now();
  const heartbeatInterval = setInterval(() => {
    if (closed) {
      clearInterval(heartbeatInterval);
      return;
    }

    const now = Date.now();
    if (now - lastHeartbeat > 20000) {
      clearInterval(heartbeatInterval);
      if (!closed) {
        closed = true;
        if (conn && !conn.closed) {
          conn.close();
        }
        if (onCloseCb) {
          onCloseCb();
        }
      }
      return;
    }

    // Send heartbeat
    try {
      if (!closed && conn && conn.open) {
        conn.send({ __hb: 1 });
      }
    } catch (e) {
      // Ignore send errors
    }
  }, 5000);

  // Handle incoming messages
  conn.on('data', (data) => {
    if (closed) return;

    // Filter out heartbeat messages
    if (data.__hb === 1) {
      lastHeartbeat = Date.now();
      return;
    }

    if (onMessageCb) {
      onMessageCb(data);
    } else {
      // Buffer message until onMessage is registered
      messageBuffer.push(data);
    }
  });

  // Handle connection close
  conn.on('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatInterval);
    if (peer) {
      peer.destroy();
    }
    if (onCloseCb) {
      onCloseCb();
    }
  });

  // Handle connection errors
  conn.on('error', () => {
    if (!closed) {
      closed = true;
      clearInterval(heartbeatInterval);
      if (peer) {
        peer.destroy();
      }
      if (onCloseCb) {
        onCloseCb();
      }
    }
  });

  return {
    id: playerPeerId,

    send(obj) {
      if (closed || !conn || !conn.open) return;
      try {
        conn.send(obj);
      } catch (e) {
        // Ignore send errors
      }
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
      clearInterval(heartbeatInterval);
      if (conn && !conn.closed) {
        conn.close();
      }
      if (peer) {
        peer.destroy();
      }
      if (onCloseCb) {
        onCloseCb();
      }
    },
  };
}
