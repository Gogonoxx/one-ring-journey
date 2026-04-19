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
  getDragBuffer,
  getRoute,
} from './route-planner.mjs';
import { renderPreview, clearPreview } from './route-preview.mjs';
import {
  PARTY_TOKEN_NAME_SETTING,
  resetPartyPosition,
} from './party-token.mjs';
import { startMarchingTest, promptRoleAssignment, getRoleAssignments } from './marching-test.mjs';
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
// Toggle tools with `active` bound to paintMode for real button feedback.
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
    'orj-roles': {
      name: 'orj-roles',
      title: 'Journey: Rollen zuweisen',
      icon: 'fa-solid fa-users',
      button: true,
      visible: game.user.isGM,
      order: 19,
      onChange: () => editRoles(),
    },
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
    layer: 'tokens',
    activeTool: modeToTool[currentMode] ?? null,
    visible: true,
    order: 80,
    tools,
  };
});

// Clear paint mode when user switches away from the Journey tab
Hooks.on('activateSceneControls', (controls) => {
  const activeName = controls?.control?.name ?? controls?.activeControl;
  if (activeName !== 'one-ring-journey' && getPaintMode()) {
    clearPaintMode();
    ui.controls?.render();
  }
});

async function editRoles() {
  if (!game.user.isGM) return;
  if (!canvas.scene) return;
  const current = getRoleAssignments();
  const result = await promptRoleAssignment(current);
  if (!result) return;
  await canvas.scene.setFlag(MODULE_ID, 'roles', result);
  ui.notifications.info('Journey: Rollen aktualisiert.');
}

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
// Attach via DOM listeners on the canvas element (not PIXI stage).
// We register in CAPTURE phase so we can block the TokenLayer's
// drag-select marquee before PIXI sees the event.
Hooks.on('canvasReady', () => {
  const el = canvas.app?.view;
  if (!el) return;

  // Remove previous listeners to avoid duplicates
  if (el._orjHandlers) {
    const h = el._orjHandlers;
    el.removeEventListener('pointerdown', h.down);
    el.removeEventListener('pointermove', h.move);
    el.removeEventListener('pointerup', h.up);
    el.removeEventListener('contextmenu', h.context);
    if (h.globalUp) {
      window.removeEventListener('pointerup', h.globalUp, true);
      window.removeEventListener('blur', h.globalUp, true);
    }
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

  // Build the list of world-space centers currently in the drag buffer,
  // used for live preview rendering.
  const bufferCenters = () => {
    const buf = getDragBuffer() ?? [];
    return buf.map(c => canvas.grid.getCenterPoint(c));
  };

  // End-drag state cleanup, safe to call multiple times
  const endDragState = async () => {
    const was = isDragging;
    isDragging = false;
    lastPaintedKey = null;
    if (!was) return;
    const mode = getPaintMode();
    if (mode === 'route') {
      clearPreview();
      await endRouteDrag();
    } else if (mode === 'event') {
      await flushPendingEventNotes();
    }
  };

  const down = async (ev) => {
    const mode = getPaintMode();
    if (!mode) return;
    if (ev.button !== 0) return;

    // Only react if the event actually started on the canvas itself.
    // This prevents hijacking clicks on UI overlays (scene controls, sidebar).
    if (ev.target !== el) return;

    isDragging = true;
    lastPaintedKey = null;

    if (mode === 'route') {
      beginRouteDrag();
      clearPreview();
    } else {
      const point = eventToLocalPoint(ev);
      await paintAtPoint(point);
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };

  const move = async (ev) => {
    if (!isDragging) return;
    const mode = getPaintMode();
    if (!mode) return;
    const point = eventToLocalPoint(ev);
    await paintAtPoint(point);

    if (mode === 'route') {
      renderPreview(bufferCenters());
    }

    ev.preventDefault();
    ev.stopImmediatePropagation();
  };

  const up = async (ev) => {
    await endDragState();
    // Only block propagation if we were actually dragging; otherwise let
    // normal UI clicks through.
  };

  const context = async (ev) => {
    const mode = getPaintMode();
    if (mode !== 'route') return;
    if (ev.target !== el) return;
    const point = eventToLocalPoint(ev);
    const syntheticEvent = { interactionData: { origin: point } };
    if (await handleRouteClick(syntheticEvent, true)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  };

  // GLOBAL safety net: any pointerup anywhere in the window should end
  // drag state, so clicks on UI elements don't leave us stuck.
  const globalUp = () => { endDragState(); };
  window.addEventListener('pointerup', globalUp, true);
  window.addEventListener('blur', globalUp, true);

  // Canvas-specific handlers for the drag flow itself.
  // NOT in capture phase anymore — we want to let the event bubble to UI
  // overlays (scene controls) if we didn't start a drag on the canvas.
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('contextmenu', context);

  el._orjHandlers = { down, move, up, context, globalUp };
});

// === Chat card click listeners ===
Hooks.on('renderChatMessageHTML', (message, html) => {
  wireJourneyCardListeners(message, html);
});
