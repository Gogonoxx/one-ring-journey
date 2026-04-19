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
  beginRouteDrag,
  endRouteDrag,
} from './route-planner.mjs';
import {
  PARTY_TOKEN_NAME_SETTING,
  resetPartyPosition,
} from './party-token.mjs';
import { startMarchingTest } from './marching-test.mjs';
import { wireJourneyCardListeners } from './event-interaction.mjs';
import { registerGMSocket } from './gm-socket.mjs';

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
  // Wire up GM socket relay so players can request route updates
  registerGMSocket();
});

// === Scene Controls ===
// Add our own "Journey" control group alongside token/measurement/etc.
//
// IMPORTANT: We use `button: true` (not toggle) for paint tools. Foundry's
// toggle mechanism assumes each tool has independent state, but we have a
// single global paintMode with radio-like behavior. Using button clicks and
// driving state via paintMode + notifications gives us reliable behavior.
Hooks.on('getSceneControlButtons', (controls) => {
  const currentMode = getPaintMode();
  const modeToTool = {
    'route': 'orj-route',
    'green': 'orj-paint-green',
    'yellow': 'orj-paint-yellow',
    'red': 'orj-paint-red',
    'event': 'orj-paint-event',
    'erase': 'orj-paint-erase',
  };
  const activeTool = modeToTool[currentMode];

  const paintTool = (key, title, icon, mode, gmOnly = true) => ({
    name: key,
    title,
    icon: `fa-solid ${icon}`,
    button: true,
    visible: gmOnly ? game.user.isGM : true,
    onChange: () => {
      if (getPaintMode() === mode) {
        clearPaintMode();
      } else {
        setPaintMode(mode);
      }
      // Re-render scene controls so activeTool reflects new paintMode
      ui.controls?.render();
    },
  });

  const tools = {
    'orj-route': {
      ...paintTool('orj-route', 'Journey: Route zeichnen', 'fa-route', 'route', false),
      order: 0,
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
    activeTool,
    visible: true,
    order: 80,
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
// Attach via DOM listeners on the canvas element (not PIXI stage) so we work
// regardless of which scene-control layer is active. Hex grid coords are
// computed via canvas.stage.toLocal() from the browser MouseEvent.
Hooks.on('canvasReady', () => {
  const el = canvas.app?.view;
  if (!el) return;

  // Remove previous listeners to avoid duplicates
  if (el._orjHandlers) {
    const h = el._orjHandlers;
    el.removeEventListener('pointerdown', h.down);
    el.removeEventListener('pointermove', h.move);
    el.removeEventListener('pointerup', h.up);
    el.removeEventListener('pointerleave', h.up);
    el.removeEventListener('contextmenu', h.context);
  }

  let isDragging = false;
  let lastPaintedKey = null;

  const eventToLocalPoint = (ev) => {
    const rect = el.getBoundingClientRect();
    const screenX = ev.clientX - rect.left;
    const screenY = ev.clientY - rect.top;
    // canvas.stage.toLocal converts browser-space → world-space
    const world = canvas.stage.toLocal({ x: screenX, y: screenY }, null, undefined, true);
    return world;
  };

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
    if (info.key === lastPaintedKey) return;
    lastPaintedKey = info.key;

    const syntheticEvent = { interactionData: { origin: point } };
    if (mode === 'route') {
      await handleRouteClick(syntheticEvent, false);
    } else {
      await handlePaintClick(syntheticEvent);
    }
  };

  const down = async (ev) => {
    const mode = getPaintMode();
    if (!mode) return;
    // Left button only for paint/route-drag
    if (ev.button !== 0) return;
    isDragging = true;
    lastPaintedKey = null;

    // Route mode: buffer starts empty for this drag. No add on pure click —
    // the user must actually drag across at least one hex for anything to happen.
    if (mode === 'route') {
      beginRouteDrag();
    } else {
      // For paint modes, the very first hex under cursor gets painted immediately
      const point = eventToLocalPoint(ev);
      await paintAtPoint(point);
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  const move = async (ev) => {
    if (!isDragging) return;
    const mode = getPaintMode();
    if (!mode) return;
    const point = eventToLocalPoint(ev);
    await paintAtPoint(point);
  };

  const up = async () => {
    const was = isDragging;
    isDragging = false;
    lastPaintedKey = null;
    if (!was) return;
    const mode = getPaintMode();
    if (mode === 'route') {
      // Commit buffered route drag to the scene in one shot
      await endRouteDrag();
    } else if (mode === 'event') {
      await flushPendingEventNotes();
    }
  };

  const context = async (ev) => {
    const mode = getPaintMode();
    if (mode !== 'route') return;
    const point = eventToLocalPoint(ev);
    const syntheticEvent = { interactionData: { origin: point } };
    if (await handleRouteClick(syntheticEvent, true)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', context);

  el._orjHandlers = { down, move, up, context };
});

// === Chat card click listeners ===
Hooks.on('renderChatMessageHTML', (message, html) => {
  wireJourneyCardListeners(message, html);
});
