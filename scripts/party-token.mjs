/**
 * Party token — finds the token named "Party" on the active scene
 * and animates it along the planned route.
 */

import { MODULE_ID } from './journey-data.mjs';
import { getHexTerrain, getEventNote } from './hex-painter.mjs';
import { getRoute, trimRouteToIndex } from './route-planner.mjs';

const PARTY_TOKEN_NAME_SETTING = 'partyTokenName';

/**
 * Find the party token on the active scene.
 * Uses the configured name (default: "Party").
 */
export function findPartyToken() {
  if (!canvas.scene) return null;
  const name = game.settings.get(MODULE_ID, PARTY_TOKEN_NAME_SETTING) || 'Party';
  const tokenDoc = canvas.scene.tokens.find(t => t.name === name);
  return tokenDoc ?? null;
}

/**
 * Get current party position index in the route
 */
export function getPartyPositionIndex() {
  return canvas.scene?.getFlag(MODULE_ID, 'partyPosition') ?? 0;
}

/**
 * Set party position index
 */
async function setPartyPositionIndex(idx) {
  await canvas.scene?.setFlag(MODULE_ID, 'partyPosition', idx);
}

/**
 * Convert cube coords to top-left token position.
 * Token is positioned by top-left; we compute from center - half token size.
 */
function cubeToTokenPosition(cube, tokenDoc) {
  const center = canvas.grid.getCenterPoint(cube);
  const size = canvas.grid.size;
  // Token width/height are in grid units; actual pixels = gridUnits * gridSize
  const tokenW = (tokenDoc.width ?? 1) * size;
  const tokenH = (tokenDoc.height ?? 1) * size;
  return {
    x: center.x - tokenW / 2,
    y: center.y - tokenH / 2,
  };
}

/**
 * Animate the party token along a number of hexes from current position.
 * Stops early if an event hex is encountered.
 * Returns { stoppedAtEvent: boolean, finalHex: cube, eventNote: string|null, hexesTraveled: number }
 */
export async function advancePartyToken(numHexes) {
  const token = findPartyToken();
  if (!token) {
    ui.notifications.error(`Journey: Party token not found. Place a token named "Party" on the scene.`);
    return { stoppedAtEvent: false, finalHex: null, hexesTraveled: 0 };
  }

  const route = getRoute();
  if (route.length === 0) {
    ui.notifications.warn('Journey: No route drawn. Players must plan a route first.');
    return { stoppedAtEvent: false, finalHex: null, hexesTraveled: 0 };
  }

  const startIdx = getPartyPositionIndex();
  const maxIdx = Math.min(startIdx + numHexes, route.length - 1);

  let hexesTraveled = 0;
  let stoppedAtEvent = false;
  let eventNote = null;
  let finalHex = route[startIdx];

  for (let i = startIdx + 1; i <= maxIdx; i++) {
    const nextCube = route[i];
    const pos = cubeToTokenPosition(nextCube, token);

    // Animate movement (v13 auto-animates on update)
    await token.update(pos, { animate: true });

    // Small delay between hex moves for visual clarity
    await new Promise(r => setTimeout(r, 350));

    hexesTraveled++;
    finalHex = nextCube;

    // Check if this is an event hex — if yes, stop
    const terrain = getHexTerrain(nextCube);
    if (terrain === 'event') {
      stoppedAtEvent = true;
      eventNote = getEventNote(nextCube);
      await setPartyPositionIndex(i);
      // Optionally trim route past the event hex so the path is visually cleaner
      break;
    }

    await setPartyPositionIndex(i);
  }

  return { stoppedAtEvent, finalHex, eventNote, hexesTraveled };
}

/**
 * Reset party to start (index 0).
 */
export async function resetPartyPosition() {
  await setPartyPositionIndex(0);
  const token = findPartyToken();
  const route = getRoute();
  if (token && route.length > 0) {
    const pos = cubeToTokenPosition(route[0], token);
    await token.update(pos, { animate: false });
  }
}

export { PARTY_TOKEN_NAME_SETTING };
