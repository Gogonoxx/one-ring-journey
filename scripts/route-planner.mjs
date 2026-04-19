/**
 * Route planner — players (and GM) can draw a travel route hex-by-hex.
 * Route is a list of cube coords stored in scene.flags.
 * Visualized as a polyline drawing (visible to all).
 */

import { MODULE_ID } from './journey-data.mjs';
import { worldPointToHexCube, hexKey } from './hex-painter.mjs';
import { requestGMAction, registerGMHandler } from './gm-socket.mjs';

const ROUTE_DRAWING_FLAG = 'routeDrawingId';

function cubesEqual(a, b) {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

export function getRoute() {
  if (!canvas.scene) return [];
  return canvas.scene.getFlag(MODULE_ID, 'route') || [];
}

/**
 * GM-only: actually persist route and rebuild visual.
 * Called locally when GM user, or via socket relay when player.
 */
async function saveRoute(route, sceneId) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) return;
  if (!game.user.isGM) {
    // Players go through the GM relay
    await requestGMAction('saveRoute', { route, sceneId: scene.id });
    return;
  }
  await scene.setFlag(MODULE_ID, 'route', route);
  await rebuildRouteVisualForScene(route, scene);
}

// Register GM-side handler for the socket relay
registerGMHandler('saveRoute', async ({ data }) => {
  const scene = game.scenes.get(data.sceneId);
  if (!scene) return;
  await scene.setFlag(MODULE_ID, 'route', data.route);
  await rebuildRouteVisualForScene(data.route, scene);
});

async function rebuildRouteVisualForScene(route, scene) {
  // GM-only helper: directly manipulate drawings on a specific scene
  const existingId = scene.getFlag(MODULE_ID, ROUTE_DRAWING_FLAG);
  if (existingId) {
    const existing = scene.drawings.get(existingId);
    if (existing) await existing.delete();
  }
  if (!route || route.length < 2) {
    await scene.unsetFlag(MODULE_ID, ROUTE_DRAWING_FLAG);
    return;
  }
  const grid = scene.grid;
  // Use the scene's grid instance directly (if available) or canvas.grid if scene is active
  const gridInstance = (canvas.scene?.id === scene.id) ? canvas.grid : null;
  if (!gridInstance) {
    console.warn(`[${MODULE_ID}] Cannot build route visual for non-active scene`);
    return;
  }
  const centers = route.map(c => gridInstance.getCenterPoint(c));
  const origin = centers[0];
  const points = [];
  for (const c of centers) {
    points.push(c.x - origin.x);
    points.push(c.y - origin.y);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] < minX) minX = points[i];
    if (points[i] > maxX) maxX = points[i];
    if (points[i+1] < minY) minY = points[i+1];
    if (points[i+1] > maxY) maxY = points[i+1];
  }
  const drawing = await foundry.documents.DrawingDocument.create({
    x: origin.x,
    y: origin.y,
    shape: {
      type: 'p',
      points,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    },
    fillType: 0,
    fillColor: '#b99b56',
    fillAlpha: 0,
    strokeWidth: 6,
    strokeColor: '#b99b56',
    strokeAlpha: 0.85,
    bezierFactor: 0,
    hidden: false,
    locked: false,
    flags: { [MODULE_ID]: { isRouteVisual: true } },
  }, { parent: scene });
  await scene.setFlag(MODULE_ID, ROUTE_DRAWING_FLAG, drawing.id);
}

/**
 * Add a hex to the route (appended at end).
 */
export async function addHexToRoute(cube) {
  const route = getRoute();

  // Don't add duplicate of last
  if (route.length > 0 && cubesEqual(route[route.length - 1], cube)) return;

  route.push({ q: cube.q, r: cube.r, s: cube.s });
  await saveRoute(route);
}

/**
 * Remove the last hex (right-click).
 */
export async function removeLastHex() {
  const route = getRoute();
  if (route.length === 0) return;
  route.pop();
  await saveRoute(route);
}

/**
 * Clear entire route.
 */
export async function clearRoute() {
  await saveRoute([]);
}

/**
 * Trim route to a given index (inclusive). Used when party stops at an event hex.
 */
export async function trimRouteToIndex(index) {
  const route = getRoute();
  const trimmed = route.slice(0, index + 1);
  await saveRoute(trimmed);
}

/**
 * Handle a canvas click while in route mode.
 * Left click = add. Right click = remove last.
 */
export async function handleCanvasClick(event, isRightClick = false) {
  const point = event.interactionData?.origin || event.data?.getLocalPosition?.(canvas.stage);
  if (!point) return false;

  const cube = worldPointToHexCube(point);
  if (!cube) return false;

  if (isRightClick) {
    await removeLastHex();
  } else {
    await addHexToRoute(cube);
  }
  return true;
}
