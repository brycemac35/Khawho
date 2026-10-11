/**
 * Transport factory: createHost and joinGame dispatch based on kind
 * Supports 'local', 'peerjs', 'firebase'
 */

import { FIREBASE_CONFIG } from '../config.js';

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
 * Get available transport kinds with labels and enabled status.
 * Returns an array of {kind, label, enabled} objects.
 * Includes dev-only 'local' transport when dev=1 in URL query.
 */
export function availableKinds() {
  const kinds = [
    { kind: 'peerjs', label: 'Standard', enabled: true },
    { kind: 'firebase', label: 'Backup (Firebase)', enabled: FIREBASE_CONFIG != null },
  ];

  // Add dev-only local transport
  if (typeof window !== 'undefined' && window.location.search.includes('dev=1')) {
    kinds.push({ kind: 'local', label: 'Local (Dev)', enabled: true });
  }

  return kinds;
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
