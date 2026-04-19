/**
 * One Ring Journey — main entry point.
 * Registers hooks, scene controls, canvas interaction, settings.
 */

import { MODULE_ID, TERRAINS } from './journey-data.mjs';
import {
  getPaintMode, setPaintMode, clearPaintMode,
  handleCanvasClick as handlePaintClick,
  flushPendingEventNotes,
} from './hex-painter.mjs';
import {
  handleCanvasClick as handleRouteClick,
  clearRoute,
} from './route-planner.mjs';
import {
  PARTY_TOKEN_NAME_SETTING,
  resetPartyPosition,
} from './party-token.mjs';
import { startMarchingTest } from './marching-test.mjs';
import { wireJourneyCardListeners } from './event-interaction.mjs';

// === Settings ===
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, PARTY_TOKEN_NAME_SETTING, {
    name: 'Party-Token-Name',
    hint: 'Name des Tokens auf der Szene, der die Party repräsentiert.',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: 'Party',
  });
});

// === Expose API ===
Hooks.once('ready', () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      startMarchingTest,
      resetJourney,
      clearPaintMode,
    };
  }
});

// === Scene Controls ===
// Add our own "Journey" control group alongside token/measurement/etc.
Hooks.on('getSceneControlButtons', (controls) => {
  const paintTool = (key, title, icon, mode, gmOnly = true) => ({
    name: key,
    title,
    icon: `fa-solid ${icon}`,
    toggle: true,
    visible: gmOnly ? game.user.isGM : true,
    active: getPaintMode() === mode,
    onChange: (_event, active) => {
      if (active) setPaintMode(mode);
      else if (getPaintMode() === mode) clearPaintMode();
    },
  });

  const tools = {
    'orj-route': {
      name: 'orj-route',
      title: 'Journey: Route zeichnen',
      icon: 'fa-solid fa-route',
      toggle: true,
      visible: true,
      active: getPaintMode() === 'route',
      order: 0,
      onChange: (_event, active) => {
        if (active) setPaintMode('route');
        else if (getPaintMode() === 'route') clearPaintMode();
      },
    },
    'orj-paint-green':  { ...paintTool('orj-paint-green',  'Journey: Sicher malen',       'fa-leaf',    'green'),  order: 10 },
    'orj-paint-yellow': { ...paintTool('orj-paint-yellow', 'Journey: Wildnis malen',      'fa-tree',    'yellow'), order: 11 },
    'orj-paint-red':    { ...paintTool('orj-paint-red',    'Journey: Feindgebiet malen',  'fa-skull',   'red'),    order: 12 },
    'orj-paint-event':  { ...paintTool('orj-paint-event',  'Journey: Event-Hex malen',    'fa-bolt',    'event'),  order: 13 },
    'orj-paint-erase':  { ...paintTool('orj-paint-erase',  'Journey: Hex löschen',        'fa-eraser',  'erase'),  order: 14 },
    'orj-marching-test': {
      name: 'orj-marching-test',
      title: 'Journey: Marching Test',
      icon: 'fa-solid fa-person-walking',
      button: true,
      visible: game.user.isGM,
      order: 20,
      onChange: () => startMarchingTest(),
    },
    'orj-reset': {
      name: 'orj-reset',
      title: 'Journey: Route zurücksetzen',
      icon: 'fa-solid fa-arrow-rotate-left',
      button: true,
      visible: game.user.isGM,
      order: 21,
      onChange: () => resetJourney(),
    },
  };

  controls['one-ring-journey'] = {
    name: 'one-ring-journey',
    title: 'Journey',
    icon: 'fa-solid fa-compass',
    layer: 'tokens',  // piggyback on token layer so clicks reach our handlers
    activeTool: 'orj-route',
    visible: true,
    order: 80,  // show after tokens/measurement/drawings
    tools,
  };
});

async function resetJourney() {
  const confirm = await foundry.applications.api.DialogV2.confirm({
    window: { title: 'Journey zurücksetzen?' },
    content: '<p>Route und Party-Position werden zurückgesetzt. Hex-Farben bleiben erhalten.</p>',
    rejectClose: false,
    modal: true,
  });
  if (!confirm) return;
  await clearRoute();
  await resetPartyPosition();
  ui.notifications.info('Journey: Zurückgesetzt.');
}

// === Canvas click/drag handler ===
// Attach to canvas listeners once canvas is ready.
// Supports drag-paint: hold mouse button and drag across hexes.
Hooks.on('canvasReady', () => {
  const stage = canvas.stage;
  if (!stage) return;

  // Remove previous listeners to avoid duplicates
  const off = (ev, fn) => { if (fn) stage.off(ev, fn); };
  off('pointerdown', canvas._orjDownHandler);
  off('pointerup', canvas._orjUpHandler);
  off('pointerupoutside', canvas._orjUpHandler);
  off('pointermove', canvas._orjMoveHandler);
  off('rightdown', canvas._orjRightHandler);

  // Track which hex was last painted in the current drag, to avoid redundant paints
  let isDragging = false;
  let lastPaintedKey = null;

  const hexKeyAtPoint = (point) => {
    if (!canvas.grid || canvas.grid.type < 2) return null;
    const cube = canvas.grid.pointToCube(point);
    const rounded = foundry.grid.HexagonalGrid.cubeRound(cube);
    return { cube: rounded, key: `${rounded.q},${rounded.r},${rounded.s}` };
  };

  const paintAtPoint = async (point) => {
    const mode = getPaintMode();
    if (!mode) return;
    const info = hexKeyAtPoint(point);
    if (!info) return;
    if (info.key === lastPaintedKey) return; // Already painted this hex in current drag
    lastPaintedKey = info.key;

    const syntheticEvent = { interactionData: { origin: point } };
    if (mode === 'route') {
      await handleRouteClick(syntheticEvent, false);
    } else {
      await handlePaintClick(syntheticEvent);
    }
  };

  const downHandler = async (event) => {
    const mode = getPaintMode();
    if (!mode) return;
    if (event.data.button !== 0) return; // Left button only for drag-paint
    isDragging = true;
    lastPaintedKey = null;
    const point = event.data.getLocalPosition(canvas.stage);
    await paintAtPoint(point);
    event.stopPropagation();
  };

  const moveHandler = async (event) => {
    if (!isDragging) return;
    const mode = getPaintMode();
    if (!mode) return;
    // Route mode: drag is less useful (would flood route with every hex). Only enable for paint modes.
    if (mode === 'route') return;
    const point = event.data.getLocalPosition(canvas.stage);
    await paintAtPoint(point);
  };

  const upHandler = async () => {
    const wasDragging = isDragging;
    isDragging = false;
    lastPaintedKey = null;
    if (!wasDragging) return;
    // If we just finished drag-painting event hexes, prompt once for the shared note
    if (getPaintMode() === 'event') {
      await flushPendingEventNotes();
    }
  };

  const rightHandler = async (event) => {
    const mode = getPaintMode();
    if (mode !== 'route') return;
    const point = event.data.getLocalPosition(canvas.stage);
    const syntheticEvent = { interactionData: { origin: point } };
    if (await handleRouteClick(syntheticEvent, true)) {
      event.stopPropagation();
    }
  };

  stage.on('pointerdown', downHandler);
  stage.on('pointermove', moveHandler);
  stage.on('pointerup', upHandler);
  stage.on('pointerupoutside', upHandler);
  stage.on('rightdown', rightHandler);

  canvas._orjDownHandler = downHandler;
  canvas._orjMoveHandler = moveHandler;
  canvas._orjUpHandler = upHandler;
  canvas._orjRightHandler = rightHandler;
});

// === Chat card click listeners ===
Hooks.on('renderChatMessageHTML', (message, html) => {
  wireJourneyCardListeners(message, html);
});
