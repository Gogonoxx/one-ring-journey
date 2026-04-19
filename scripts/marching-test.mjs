/**
 * Marching Test orchestration.
 *
 * Flow:
 *   1. Ensure roles are assigned (dialog if not)
 *   2. Guide's player rolls Survival/Nature via PF2E skill API
 *   3. Read degree of success → hex count
 *   4. Animate party token forward
 *   5. On arrival:
 *       - event hex? → post event-hex card, stop
 *       - otherwise → roll d6 for role, post stage-1 card with "Reveal Event" button
 */

import { MODULE_ID, TERRAINS, ROLES, MARCHING_RESULT } from './journey-data.mjs';
import { getHexTerrain } from './hex-painter.mjs';
import { getRoute } from './route-planner.mjs';
import { findPartyToken, advancePartyToken, getPartyPositionIndex } from './party-token.mjs';
import { rollAffectedRole, getEffectiveDC } from './event-roller.mjs';
import { renderMarchingTestCard, renderEventStage1, renderEventHexCard, renderSkillPromptCard } from './chat-cards.mjs';

/**
 * Return the current role → actorId map. Empty object if nothing assigned.
 */
export function getRoleAssignments() {
  return canvas.scene?.getFlag(MODULE_ID, 'roles') || {};
}

async function saveRoleAssignments(roles) {
  await canvas.scene.setFlag(MODULE_ID, 'roles', roles);
}

/**
 * Prompt the GM to assign roles via a dialog.
 * Returns the roles object or null if cancelled.
 */
export async function promptRoleAssignment(currentRoles = {}) {
  // Build options from all player-owned PCs on this scene
  const actors = game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner);

  if (actors.length === 0) {
    ui.notifications.warn('Journey: No player characters found to assign roles.');
    return null;
  }

  const buildOptions = (selectedId) => actors.map(a =>
    `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${foundry.utils.escapeHTML(a.name)}</option>`
  ).join('');

  const content = `
    <form class="orj-role-assignment" style="display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; padding: 8px;">
      ${Object.values(ROLES).map(role => `
        <label for="orj-role-${role.key}"><strong>${role.label}:</strong></label>
        <select name="${role.key}" id="orj-role-${role.key}">
          <option value="">— auswählen —</option>
          ${buildOptions(currentRoles[role.key])}
        </select>
      `).join('')}
    </form>
  `;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: 'Journey — Rollen zuweisen' },
    content,
    ok: {
      label: 'Speichern',
      callback: (event, button, dialog) => {
        const result = {};
        for (const role of Object.values(ROLES)) {
          const select = dialog.element.querySelector(`select[name="${role.key}"]`);
          result[role.key] = select?.value || null;
        }
        return result;
      },
    },
    rejectClose: false,
    modal: true,
  });
}

/**
 * Main entry: trigger a marching test.
 * Only GM calls this.
 */
export async function startMarchingTest() {
  if (!game.user.isGM) {
    ui.notifications.warn('Nur der GM kann einen Marching Test auslösen.');
    return;
  }
  if (!canvas.scene) return;

  // 1. Ensure roles are assigned
  let roles = getRoleAssignments();
  const hasAll = Object.keys(ROLES).every(k => roles[k]);
  if (!hasAll) {
    const result = await promptRoleAssignment(roles);
    if (!result) return;
    roles = result;
    await saveRoleAssignments(roles);
  }

  // 2. Ensure route exists and party token is on first hex
  const route = getRoute();
  if (route.length < 2) {
    ui.notifications.warn('Journey: Route muss mindestens 2 Hexes enthalten. Spieler sollen eine Route zeichnen.');
    return;
  }

  const partyToken = findPartyToken();
  if (!partyToken) {
    ui.notifications.error('Journey: Kein Party-Token gefunden. Platziere einen Token namens "Party" auf der Szene.');
    return;
  }

  // 3. Post skill-prompt card for Guide player (they click their own button to roll)
  const guideActor = game.actors.get(roles.guide);
  if (!guideActor) {
    ui.notifications.error('Journey: Guide-Actor nicht gefunden.');
    return;
  }

  // Determine DC from terrain at current party position
  const startIdx = getPartyPositionIndex();
  const currentHex = route[startIdx];
  const currentTerrain = getHexTerrain(currentHex) || 'yellow';
  const dc = getEffectiveDC(currentTerrain, 0);

  const promptId = `marching-${foundry.utils.randomID()}`;
  const skill1 = ROLES.guide.skills[0];
  const skill2 = ROLES.guide.skills[1];
  const skill1Mod = (guideActor.skills?.[skill1] ?? guideActor.perception)?.mod ?? 0;
  const skill2Mod = (guideActor.skills?.[skill2] ?? guideActor.perception)?.mod ?? 0;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guideActor }),
    content: renderSkillPromptCard({
      actor: guideActor.name,
      role: ROLES.guide.label,
      skill1, skill1Mod, skill2, skill2Mod,
      dc,
      context: `Marching Test (${TERRAINS[currentTerrain].label})`,
      flavor: `${guideActor.name} führt die Gruppe durch das ${TERRAINS[currentTerrain].label}.`,
      promptId,
    }),
    flags: {
      [MODULE_ID]: {
        promptType: 'marching-test',
        promptId,
        actorId: guideActor.id,
        dc,
        terrainKey: currentTerrain,
      },
    },
  });
  // Execution continues via handleMarchingRoll() when the player clicks
}

/**
 * Called from event-interaction when Guide clicks a skill button on a
 * marching-test prompt card. Performs the roll and runs the full
 * post-roll flow (token advance + event phase).
 */
export async function handleMarchingRoll(message, skillKey) {
  const flags = message.flags?.[MODULE_ID];
  if (!flags || flags.promptType !== 'marching-test') return;

  const guideActor = game.actors.get(flags.actorId);
  if (!guideActor) return;

  // Only the Guide's owner (or GM) can roll
  if (!guideActor.isOwner) {
    ui.notifications.warn('Nur der Guide-Spieler kann diesen Check würfeln.');
    return;
  }

  const currentTerrain = flags.terrainKey || 'yellow';
  const dc = flags.dc;
  const rollResult = await performSkillRoll(
    guideActor,
    skillKey,
    dc,
    `Marching Test (${TERRAINS[currentTerrain].label})`,
  );
  if (!rollResult) return;

  // Consume the prompt so it can't be clicked again
  try {
    await message.delete();
  } catch (err) {
    await message.update({ flags: { [MODULE_ID]: { ...flags, consumed: true } } });
  }

  const dos = rollResult.degreeOfSuccess ?? deriveDoSFromTotal(rollResult.total, dc, rollResult.rawRoll);
  const outcome = MARCHING_RESULT[dos];
  const hexes = outcome.hexes;

  // Post result card
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: guideActor }),
    content: renderMarchingTestCard({
      guide: guideActor.name,
      terrain: TERRAINS[currentTerrain],
      outcome: dos,
      hexesAdvanced: hexes,
    }),
  });

  // Continue with token advance + event phase (GM-only from here on)
  if (!game.user.isGM) {
    // Ask GM to continue via socket? Simplest: have GM observe and continue.
    // For now, only run the rest if this client IS the GM.
    ui.notifications.info('Der GM setzt die Reise fort...');
    return;
  }

  await continueAfterMarching(hexes, roles => roles, guideActor);
}

// Separate helper so both the direct flow (legacy) and the new button
// flow can share the post-roll steps.
async function continueAfterMarching(hexes, _unused, _guideActor) {
  const roles = getRoleAssignments();
  const result = await advancePartyToken(hexes);

  // 5. Handle arrival
  if (result.stoppedAtEvent) {
    await ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM'),
      speaker: { alias: 'Journey' },
      content: renderEventHexCard({ eventNote: result.eventNote }),
    });
    return;
  }

  // Normal event roll phase
  if (!result.finalHex) return;
  const finalTerrain = getHexTerrain(result.finalHex) || 'yellow';
  const terrainData = TERRAINS[finalTerrain];

  // Roll d6 with animation
  const { total: d6Total, role } = await rollAffectedRole();

  // Get the actor for that role
  const affectedActorId = roles[role.key];
  const affectedActor = game.actors.get(affectedActorId);
  const actorName = affectedActor?.name ?? '(unbekannt)';

  // Build flags to persist state across the 2-stage reveal
  const messageFlags = {
    [MODULE_ID]: {
      stage: 1,
      terrainKey: finalTerrain,
      roleKey: role.key,
      affectedActorId,
      baseDC: terrainData.dc ?? 15,
      dcOffset: 0,
      d6: d6Total,
    },
  };

  await ChatMessage.create({
    speaker: { alias: 'Journey' },
    content: renderEventStage1({
      terrain: terrainData,
      role,
      actorName,
      messageFlagsJSON: JSON.stringify(messageFlags[MODULE_ID]),
    }),
    flags: messageFlags,
  });
}

/**
 * Prompt player to choose between role's two skills.
 */
async function promptSkillChoice(actor, role) {
  const skillMods = role.skills.map(s => {
    const stat = actor.skills?.[s] ?? actor.perception;
    const mod = stat?.mod ?? 0;
    return { key: s, mod, label: s.charAt(0).toUpperCase() + s.slice(1) };
  });

  const buttons = {};
  for (const sm of skillMods) {
    buttons[sm.key] = {
      label: `${sm.label} (${sm.mod >= 0 ? '+' : ''}${sm.mod})`,
      callback: () => sm.key,
    };
  }

  return foundry.applications.api.DialogV2.wait({
    window: { title: `${role.label}: Skill wählen` },
    content: `<p style="padding: 8px 0;">${foundry.utils.escapeHTML(actor.name)} würfelt als ${role.label}. Welchen Skill?</p>`,
    buttons: Object.entries(buttons).map(([key, val]) => ({
      action: key,
      label: val.label,
      callback: () => key,
    })),
    rejectClose: false,
    modal: true,
  });
}

/**
 * Perform a PF2E skill roll for an actor.
 * Returns an object { total, degreeOfSuccess, rawRoll } or null on cancel.
 *
 * PF2E's Statistic.roll() returns a wrapper that has .degreeOfSuccess and .total
 * directly on it. The inner Roll (if present) has no PF2E-specific fields, so
 * don't unwrap.
 */
export async function performSkillRoll(actor, skillKey, dc, label = '') {
  const stat = actor.skills?.[skillKey] ?? actor.perception;
  if (!stat) {
    ui.notifications.error(`Journey: Skill ${skillKey} nicht gefunden.`);
    return null;
  }
  try {
    const result = await stat.roll({
      dc: { value: dc },
      extraRollOptions: [`${MODULE_ID}:journey-check`],
      label,
    });
    if (!result) return null;

    // The PF2E wrapper exposes degreeOfSuccess + total directly.
    // Fall back to the inner Roll's total if needed.
    const total = result.total ?? result.roll?.total ?? result.options?.total;
    const dos = result.degreeOfSuccess ?? result.options?.outcome?.degreeOfSuccess;

    return {
      total,
      degreeOfSuccess: dos,
      rawRoll: result.roll ?? result,
    };
  } catch (err) {
    console.error('One Ring Journey: skill roll failed', err);
    return null;
  }
}

/**
 * Derive degree of success from a total vs DC (fallback only).
 */
export function deriveDoSFromTotal(total, dc, rawRoll) {
  if (typeof total !== 'number') return 1;
  const natural = rawRoll?.dice?.[0]?.results?.[0]?.result ?? 10;
  let dos;
  if (total >= dc + 10) dos = 3;
  else if (total >= dc) dos = 2;
  else if (total <= dc - 10) dos = 0;
  else dos = 1;
  if (natural === 20) dos = Math.min(3, dos + 1);
  else if (natural === 1) dos = Math.max(0, dos - 1);
  return dos;
}
