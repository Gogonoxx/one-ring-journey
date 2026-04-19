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

/**
 * Catmull-Rom-ish smoothing: return a dense array of interpolated points
 * along the path, turning the angular hex-center chain into a flowing curve.
 */
function smoothPath(centers, samplesPerSegment = 8) {
  if (centers.length < 2) return [...centers];
  // For each segment we use the previous/next point to compute a curvature.
  const out = [];
  const pt = (i) => centers[Math.max(0, Math.min(centers.length - 1, i))];
  for (let i = 0; i < centers.length - 1; i++) {
    const p0 = pt(i - 1);
    const p1 = pt(i);
    const p2 = pt(i + 1);
    const p3 = pt(i + 2);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom with tension 0.5
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      out.push({ x, y });
    }
  }
  out.push(centers[centers.length - 1]);
  return out;
}

/**
 * Distance between two points.
 */
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Sample points evenly along a polyline at a fixed spacing.
 */
function resample(points, spacing) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = dist(a, b);
    let remaining = segLen - (spacing - carry);
    if (remaining < 0) {
      carry += segLen;
      continue;
    }
    // Step along this segment
    let t = (spacing - carry) / segLen;
    while (t <= 1 + 1e-9) {
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      t += spacing / segLen;
    }
    // carry is the leftover distance past the last placed dot toward b
    const placedCount = out.length - 1;
    const lastPlaced = out[out.length - 1];
    carry = dist(lastPlaced, b);
  }
  return out;
}

async function rebuildRouteVisualForScene(route, scene) {
  // GM-only helper: directly manipulate drawings on a specific scene.
  // Delete ALL drawings flagged as route visual to prevent orphans.
  const toDelete = scene.drawings
    .filter(d => d.getFlag(MODULE_ID, 'isRouteVisual'))
    .map(d => d.id);
  if (toDelete.length > 0) {
    await scene.deleteEmbeddedDocuments('Drawing', toDelete);
  }
  if (!route || route.length < 2) {
    await scene.unsetFlag(MODULE_ID, ROUTE_DRAWING_FLAG);
    return;
  }

  const gridInstance = (canvas.scene?.id === scene.id) ? canvas.grid : null;
  if (!gridInstance) {
    console.warn(`[${MODULE_ID}] Cannot build route visual for non-active scene`);
    return;
  }

  // Build a smooth, path-like polyline through hex centers
  const centers = route.map(c => gridInstance.getCenterPoint(c));
  const smoothed = smoothPath(centers, 10);

  // Sample dots evenly along the smoothed path
  const gridSize = scene.grid.size;
  const dotSpacing = Math.max(18, gridSize * 0.22); // ~22% of a hex
  const dotRadius = Math.max(4, gridSize * 0.045);
  const dots = resample(smoothed, dotSpacing);

  // Foundry's DrawingDocument supports ellipse shape (type: 'e').
  // Create one small filled ellipse per dot.
  const dotDocs = dots.map(p => ({
    x: p.x - dotRadius,
    y: p.y - dotRadius,
    shape: {
      type: 'e',
      width: dotRadius * 2,
      height: dotRadius * 2,
    },
    fillType: 1,
    fillColor: '#1a1a1a',
    fillAlpha: 0.85,
    strokeWidth: 1,
    strokeColor: '#1a1a1a',
    strokeAlpha: 0.9,
    hidden: false,
    locked: false,
    flags: { [MODULE_ID]: { isRouteVisual: true } },
  }));

  // Batch-create all dots in a single DB round-trip
  const created = await scene.createEmbeddedDocuments('Drawing', dotDocs);
  // Store only the first id as marker; the filter-by-flag on delete handles the rest
  if (created.length > 0) {
    await scene.setFlag(MODULE_ID, ROUTE_DRAWING_FLAG, created[0].id);
  }
}

// In-memory buffer for drag-mode: add hexes fast, commit once on drag-end.
let dragBuffer = null;

export function beginRouteDrag() {
  dragBuffer = [...getRoute()];
}

export async function endRouteDrag() {
  if (dragBuffer === null) return;
  const toCommit = dragBuffer;
  dragBuffer = null;
  await saveRoute(toCommit);
}

/**
 * Add a hex to the route. If currently dragging, only updates the buffer
 * (no scene write) so movement stays responsive. Commit happens on drag-end.
 */
export async function addHexToRoute(cube) {
  if (dragBuffer !== null) {
    const last = dragBuffer[dragBuffer.length - 1];
    if (last && cubesEqual(last, cube)) return;
    dragBuffer.push({ q: cube.q, r: cube.r, s: cube.s });
    return;
  }
  const route = getRoute();
  if (route.length > 0 && cubesEqual(route[route.length - 1], cube)) return;
  route.push({ q: cube.q, r: cube.r, s: cube.s });
  await saveRoute(route);
}

/**
 * Remove the last hex (right-click).
 */
export async function removeLastHex() {
  if (dragBuffer !== null) {
    dragBuffer.pop();
    return;
  }
  const route = getRoute();
  if (route.length === 0) return;
  route.pop();
  await saveRoute(route);
}

/**
 * Clear entire route. GM-only helper called by the Reset button.
 * Aggressively removes ANY drawings flagged as our route visual, even orphans.
 */
export async function clearRoute() {
  dragBuffer = null;

  if (game.user.isGM && canvas.scene) {
    // Delete every drawing on this scene that claims to be our route visual
    const orphans = canvas.scene.drawings
      .filter(d => d.getFlag(MODULE_ID, 'isRouteVisual'))
      .map(d => d.id);
    if (orphans.length > 0) {
      await canvas.scene.deleteEmbeddedDocuments('Drawing', orphans);
    }
    await canvas.scene.unsetFlag(MODULE_ID, ROUTE_DRAWING_FLAG);
  }

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
