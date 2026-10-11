/**
 * Transport factory: createHost and joinGame dispatch based on kind
 * Supports 'local', 'peerjs', 'firebase'
 */

/**
 * Create a host for the given kind.
 * @param {string} kind - 'local', 'peerjs', or 'firebase'
 * @param {object} opts - transport-specific options (must include pin)
 * @returns {Promise<Host>}
 */
export async function createHost(kind, opts) {
  const { createHost: impl } = await getTransport(kind);
  return impl(opts);
}

/**
 * Join a game for the given kind.
 * @param {string} kind - 'local', 'peerjs', or 'firebase'
 * @param {string} pin
 * @param {object} opts - transport-specific options (e.g., timeoutMs)
 * @returns {Promise<Connection>}
 */
export async function joinGame(kind, pin, opts) {
  const { joinGame: impl } = await getTransport(kind);
  return impl(pin, opts);
}

/**
 * Dynamically import the transport module for the given kind.
 * @private
 */
async function getTransport(kind) {
  switch (kind) {
    case 'local':
      return import('./local.js');
    case 'peerjs':
      return import('./peerjs.js');
    case 'firebase':
      return import('./firebase.js');
    default:
      throw new Error(`Unknown transport kind: ${kind}`);
  }
}
