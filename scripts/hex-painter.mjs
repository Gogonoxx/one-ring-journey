/**
 * Hex painter — allows GM to color hexes (green/yellow/red/event/erase).
 * Uses DrawingDocument (hidden from players) to paint overlay on hex grid.
 * Persistent per scene via scene flags.
 */

import { MODULE_ID, TERRAINS } from './journey-data.mjs';

// Current paint mode. null = no painting. One of: 'green', 'yellow', 'red', 'event', 'erase', 'route'
let paintMode = null;

// Track keys of event-hexes painted during current drag — notes prompted once at drag end
let pendingEventHexKeys = [];

export function getPaintMode() {
  return paintMode;
}

export function setPaintMode(mode) {
  paintMode = mode;
  ui.notifications.info(`Journey: ${mode ? 'Painting mode — ' + mode : 'Paint off'}`);
}

export function clearPaintMode() {
  paintMode = null;
}

export function getPendingEventHexKeys() {
  return pendingEventHexKeys;
}

export function clearPendingEventHexKeys() {
  pendingEventHexKeys = [];
}

function hexKey(cube) {
  return `${cube.q},${cube.r},${cube.s}`;
}

/**
 * Get the hex cube coords at a world point.
 */
function worldPointToHexCube(point) {
  if (!canvas.grid || canvas.grid.type < 2) return null; // Only hex grids
  const cube = canvas.grid.pointToCube(point);
  // Round to nearest integer cube (pointToCube can return fractional)
  return foundry.grid.HexagonalGrid.cubeRound(cube);
}

/**
 * Build a hex polygon relative to a given center point (for Drawing shape.points)
 */
function buildHexPolygonPoints(cube) {
  const center = canvas.grid.getCenterPoint(cube);
  const vertices = canvas.grid.getVertices(cube);
  // points is flat array [x0, y0, x1, y1, ...] relative to drawing's (x, y)
  const points = [];
  for (const v of vertices) {
    points.push(v.x - center.x);
    points.push(v.y - center.y);
  }
  return { center, points };
}

/**
 * Find an existing hex-paint drawing at a cube coord on the active scene.
 */
function findHexDrawing(cubeKey) {
  if (!canvas.scene) return null;
  return canvas.scene.drawings.find(d => d.getFlag(MODULE_ID, 'hexCoord') === cubeKey);
}

/**
 * Paint (or erase) a single hex.
 * For event-mode, the note is NOT prompted here — it's deferred until drag ends
 * so drag-painting multiple event hexes only asks once for a shared note.
 */
export async function paintHex(cube) {
  if (!canvas.scene || !game.user.isGM) return;

  const mode = paintMode;
  if (!mode || mode === 'route') return;

  const key = hexKey(cube);
  const existing = findHexDrawing(key);
  const hexColors = canvas.scene.getFlag(MODULE_ID, 'hexColors') || {};
  const eventNotes = canvas.scene.getFlag(MODULE_ID, 'eventNotes') || {};

  if (mode === 'erase') {
    if (existing) await existing.delete();
    delete hexColors[key];
    delete eventNotes[key];
    await canvas.scene.setFlag(MODULE_ID, 'hexColors', hexColors);
    await canvas.scene.setFlag(MODULE_ID, 'eventNotes', eventNotes);
    return;
  }

  const terrain = TERRAINS[mode];
  if (!terrain) return;

  // For event hexes: remember the key so the note prompt fires ONCE after drag ends.
  // Keep any existing note on this hex by default.
  let eventNote = eventNotes[key] || '';
  if (mode === 'event') {
    if (!pendingEventHexKeys.includes(key)) pendingEventHexKeys.push(key);
  } else {
    delete eventNotes[key];
  }

  // Remove existing drawing (if any) to replace with new color
  if (existing) await existing.delete();

  const { center, points } = buildHexPolygonPoints(cube);

  // Compute polygon bounding box (required by v13 shape validation)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] < minX) minX = points[i];
    if (points[i] > maxX) maxX = points[i];
    if (points[i+1] < minY) minY = points[i+1];
    if (points[i+1] > maxY) maxY = points[i+1];
  }
  const shapeWidth = maxX - minX;
  const shapeHeight = maxY - minY;

  const drawingData = {
    x: center.x,
    y: center.y,
    shape: {
      type: 'p', // polygon
      points,
      width: shapeWidth,
      height: shapeHeight,
    },
    fillType: 1, // SOLID
    fillColor: terrain.color,
    fillAlpha: terrain.alpha,
    strokeWidth: 2,
    strokeColor: terrain.color,
    strokeAlpha: 0.8,
    hidden: true, // GM-only
    locked: false,
    flags: {
      [MODULE_ID]: {
        hexCoord: key,
        hexType: mode,
        eventNote: eventNote,
      },
    },
  };

  await foundry.documents.DrawingDocument.create(drawingData, { parent: canvas.scene });

  hexColors[key] = mode;
  await canvas.scene.setFlag(MODULE_ID, 'hexColors', hexColors);
  await canvas.scene.setFlag(MODULE_ID, 'eventNotes', eventNotes);
}

async function promptEventNote(existing = '', hexCount = 1) {
  const intro = hexCount > 1
    ? `<p>Notiz für die gerade gemalten <strong>${hexCount} Event-Hexes</strong> (gleiche Notiz für alle):</p>`
    : `<p>Was passiert, wenn die Party diesen Hex betritt?</p>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: 'Event-Hex: Notiz' },
    content: `
      <div style="padding: 8px 0;">
        ${intro}
        <textarea name="note" rows="4" style="width: 100%;" placeholder="z.B.: Zwei Reiterklans kämpfen hier — Party gerät zwischen die Fronten.">${foundry.utils.escapeHTML(existing)}</textarea>
      </div>
    `,
    ok: {
      label: 'Speichern',
      callback: (event, button, dialog) => {
        return dialog.element.querySelector('textarea[name="note"]').value;
      },
    },
    rejectClose: false,
    modal: true,
  });
}

/**
 * Called by main.mjs when a drag-paint ends in event mode.
 * Shows a single note dialog for all freshly-painted event hexes.
 */
export async function flushPendingEventNotes() {
  if (!canvas.scene) return;
  if (pendingEventHexKeys.length === 0) return;

  const keys = [...pendingEventHexKeys];
  pendingEventHexKeys = [];

  const eventNotes = canvas.scene.getFlag(MODULE_ID, 'eventNotes') || {};
  // Seed with existing note from first painted hex (if it had one)
  const seed = keys.map(k => eventNotes[k]).find(n => n && n.trim()) || '';

  const note = await promptEventNote(seed, keys.length);
  if (note === null) return;

  for (const k of keys) {
    eventNotes[k] = note;
  }
  await canvas.scene.setFlag(MODULE_ID, 'eventNotes', eventNotes);
}

/**
 * Get the terrain type (green/yellow/red/event) of a hex on the active scene.
 */
export function getHexTerrain(cube) {
  if (!canvas.scene) return null;
  const hexColors = canvas.scene.getFlag(MODULE_ID, 'hexColors') || {};
  return hexColors[hexKey(cube)] || null;
}

/**
 * Get the event note of an event-hex.
 */
export function getEventNote(cube) {
  if (!canvas.scene) return '';
  const notes = canvas.scene.getFlag(MODULE_ID, 'eventNotes') || {};
  return notes[hexKey(cube)] || '';
}

/**
 * Handle a canvas click while in paint mode.
 * Called from the canvas click listener in main.mjs.
 */
export async function handleCanvasClick(event) {
  if (!game.user.isGM) return false;
  if (!paintMode || paintMode === 'route') return false;

  const point = event.interactionData.origin;
  const cube = worldPointToHexCube(point);
  if (!cube) return false;

  await paintHex(cube);
  return true; // handled
}

export { hexKey, worldPointToHexCube };
