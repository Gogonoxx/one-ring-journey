/**
 * GM socket relay — lets players request route updates that only the GM can write.
 * Scene flags and Drawings require GM permission. Players send requests via
 * socket; the active GM executes them.
 */

import { MODULE_ID } from './journey-data.mjs';

const SOCKET_EVENT = `module.${MODULE_ID}`;

// Handlers by action
const handlers = new Map();

/**
 * Called on init to wire up the socket.
 */
export function registerGMSocket() {
  game.socket.on(SOCKET_EVENT, async (payload) => {
    if (!payload) return;
    // Only the active GM handles these
    if (!game.user.isGM) return;
    // Only first active GM to avoid duplicate execution
    if (!isActiveGM()) return;

    const handler = handlers.get(payload.action);
    if (!handler) {
      console.warn(`[${MODULE_ID}] No handler for action`, payload.action);
      return;
    }
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[${MODULE_ID}] GM socket handler failed`, err);
    }
  });
}

/**
 * Returns true if this client is the "active" GM (lowest user id among online GMs).
 * Used so only one GM executes the relay if multiple are online.
 */
function isActiveGM() {
  const onlineGMs = game.users.filter(u => u.isGM && u.active);
  if (onlineGMs.length === 0) return false;
  const sorted = onlineGMs.sort((a, b) => a.id.localeCompare(b.id));
  return sorted[0].id === game.user.id;
}

/**
 * Register a handler for a specific action type.
 */
export function registerGMHandler(action, fn) {
  handlers.set(action, fn);
}

/**
 * Send a request to the GM to perform an action.
 * If the caller IS the GM, execute immediately (skip socket hop).
 */
export async function requestGMAction(action, data = {}) {
  const payload = { action, data, from: game.user.id };
  if (game.user.isGM) {
    const handler = handlers.get(action);
    if (handler) await handler(payload);
    return;
  }
  game.socket.emit(SOCKET_EVENT, payload);
}
