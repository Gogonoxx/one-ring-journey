/**
 * Handles click interactions on Journey chat cards:
 * - Reveal Event (stage 1 → stage 2)
 * - DC adjust buttons
 * - Start skill check
 * Also applies consequences after the skill check resolves.
 */

import { MODULE_ID, TERRAINS, ROLES, EVENTS, formatDCOffset } from './journey-data.mjs';
import { renderEventStage2, renderEventResult } from './chat-cards.mjs';
import { rollEventDie } from './event-roller.mjs';
import { performSkillRoll } from './marching-test.mjs';
import { burnHitDiceForAll, applyDrainedToActor, burnHitDiceForActor } from './hit-dice-bridge.mjs';

function getFlags(message) {
  return message.getFlag(MODULE_ID, 'stage') !== undefined
    ? message.flags[MODULE_ID]
    : null;
}

/**
 * Stage 1 → Stage 2 transition. GM only.
 */
async function handleRevealEvent(message) {
  if (!game.user.isGM) return;
  const flags = getFlags(message);
  if (!flags || flags.stage !== 1) return;

  const { total: d12Total, event } = await rollEventDie(flags.terrainKey);

  const newFlags = {
    ...flags,
    stage: 2,
    d12: d12Total,
    eventId: event.id,
  };

  const terrain = TERRAINS[flags.terrainKey];
  const role = ROLES[flags.roleKey];
  const affectedActor = game.actors.get(flags.affectedActorId);
  const actorName = affectedActor?.name ?? '(unbekannt)';

  await message.update({
    content: renderEventStage2({
      terrain,
      role,
      actorName,
      event,
      d12Roll: d12Total,
      baseDC: flags.baseDC,
      dcOffset: 0,
      isGM: true, // message re-rendered for all via renderChatMessageHTML
    }),
    flags: { [MODULE_ID]: newFlags },
  });
}

/**
 * DC adjustment button clicked. GM only.
 */
async function handleDCAdjust(message, delta) {
  if (!game.user.isGM) return;
  const flags = getFlags(message);
  if (!flags || flags.stage !== 2) return;

  const newOffset = delta; // absolute set (each button represents final offset)
  const event = EVENTS[flags.eventId];
  const terrain = TERRAINS[flags.terrainKey];
  const role = ROLES[flags.roleKey];
  const affectedActor = game.actors.get(flags.affectedActorId);

  await message.update({
    content: renderEventStage2({
      terrain,
      role,
      actorName: affectedActor?.name ?? '(unbekannt)',
      event,
      d12Roll: flags.d12,
      baseDC: flags.baseDC,
      dcOffset: newOffset,
      isGM: true,
    }),
    flags: { [MODULE_ID]: { ...flags, dcOffset: newOffset } },
  });
}

/**
 * Start the skill check for the affected actor.
 * Triggers automatic skill roll with current effective DC.
 */
async function handleStartSkillCheck(message) {
  if (!game.user.isGM) return;
  const flags = getFlags(message);
  if (!flags || flags.stage !== 2) return;

  const event = EVENTS[flags.eventId];
  const role = ROLES[flags.roleKey];
  const affectedActor = game.actors.get(flags.affectedActorId);
  if (!affectedActor) {
    ui.notifications.error('Journey: Betroffener Actor nicht gefunden.');
    return;
  }

  const effectiveDC = flags.baseDC + (flags.dcOffset || 0);

  // Build skill choice buttons so player picks their skill
  const skillMods = role.skills.map(s => {
    const stat = affectedActor.skills?.[s] ?? affectedActor.perception;
    return { key: s, label: s.charAt(0).toUpperCase() + s.slice(1), mod: stat?.mod ?? 0 };
  });

  const skillKey = await foundry.applications.api.DialogV2.wait({
    window: { title: `${role.label}: Skill wählen (${affectedActor.name})` },
    content: `<p style="padding: 8px 0;">Welchen Skill benutzt ${foundry.utils.escapeHTML(affectedActor.name)} für das Event?</p>`,
    buttons: skillMods.map(sm => ({
      action: sm.key,
      label: `${sm.label} (${sm.mod >= 0 ? '+' : ''}${sm.mod})`,
      callback: () => sm.key,
    })),
    rejectClose: false,
    modal: true,
  });
  if (!skillKey) return;

  const roll = await performSkillRoll(
    affectedActor,
    skillKey,
    effectiveDC,
    `${event.name} — ${role.label}`
  );
  if (!roll) return;

  const dos = roll.degreeOfSuccess ?? deriveDoS(roll, effectiveDC);
  await applyConsequences({
    event,
    affectedActor,
    dos,
    skillName: skillKey,
    rollTotal: roll.total,
    effectiveDC,
  });

  // Mark message as resolved
  await message.update({
    flags: {
      [MODULE_ID]: {
        ...flags,
        stage: 3,
        resolvedAt: Date.now(),
      },
    },
  });
}

async function applyConsequences({ event, affectedActor, dos, skillName, rollTotal, effectiveDC }) {
  const outcomeMap = {
    3: { label: 'Critical Success', rarity: 'rarity rare' },
    2: { label: 'Success', rarity: 'rarity uncommon' },
    1: { label: 'Failure', rarity: '' },
    0: { label: 'Critical Failure', rarity: 'rarity unique' },
  };
  const outcome = outcomeMap[dos];

  const consequences = [];

  // Always-burn HD for all (events 1-8)
  if (event.hdBurnAll > 0) {
    await burnHitDiceForAll(event.hdBurnAll);
    consequences.push(`Alle: −${event.hdBurnAll} HD`);
  }

  // Failure / Crit Failure consequences
  if (dos <= 1) {
    switch (event.id) {
      case 1: // Terrible Misfortune → all drained 1
        for (const actor of game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner)) {
          await applyDrainedToActor(actor, 1);
        }
        consequences.push('Alle: Drained 1 (bis volle Rast)');
        break;
      case 2: // Despair → target drained 1
        await applyDrainedToActor(affectedActor, 1);
        consequences.push(`${affectedActor.name}: Drained 1 (bis volle Rast)`);
        break;
      case 3:
      case 4: // Ill Choices → target −1 extra HD
        await burnHitDiceForActor(affectedActor, 1);
        consequences.push(`${affectedActor.name}: −1 HD zusätzlich`);
        break;
      case 5:
      case 6:
      case 7:
      case 8: // Mishap → +1 day
        consequences.push('+1 Tag zur Reise (neuer Marching Test folgt)');
        break;
    }
  }

  // Success bonuses (events 9-12)
  if (dos >= 2) {
    if (event.id === 9 || event.id === 10) {
      consequences.push('Reise −1 Tag (kürzerer Pfad gefunden)');
    } else if (event.id === 11) {
      consequences.push('Positive Begegnung (GM improvisiert)');
    } else if (event.id === 12) {
      consequences.push('Alle: +2 verbrannte HD regeneriert ODER Drained −1 (Wahl pro PC)');
    }
  }

  if (consequences.length === 0) {
    consequences.push('Keine mechanischen Auswirkungen.');
  }

  await ChatMessage.create({
    speaker: { alias: 'Journey' },
    content: renderEventResult({
      event,
      actorName: affectedActor.name,
      skillName: skillName.charAt(0).toUpperCase() + skillName.slice(1),
      rollTotal,
      effectiveDC,
      outcomeLabel: outcome.label,
      outcomeRarity: outcome.rarity,
      consequences,
    }),
  });
}

function deriveDoS(roll, dc) {
  const total = roll.total;
  const natural = roll.dice?.[0]?.results?.[0]?.result ?? 10;
  let dos;
  if (total >= dc + 10) dos = 3;
  else if (total >= dc) dos = 2;
  else if (total <= dc - 10) dos = 0;
  else dos = 1;
  if (natural === 20) dos = Math.min(3, dos + 1);
  else if (natural === 1) dos = Math.max(0, dos - 1);
  return dos;
}

/**
 * Wire up click listeners on Journey chat cards.
 * Called from renderChatMessageHTML hook.
 */
export function wireJourneyCardListeners(message, html) {
  const card = html.querySelector(`.chat-card[data-module="${MODULE_ID}"]`);
  if (!card) return;

  const revealBtn = card.querySelector('[data-action="orj-reveal-event"]');
  revealBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    revealBtn.disabled = true;
    try { await handleRevealEvent(message); }
    finally { revealBtn.disabled = false; }
  });

  for (const btn of card.querySelectorAll('[data-action="orj-dc-adjust"]')) {
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const delta = Number(btn.dataset.delta);
      await handleDCAdjust(message, delta);
    });
  }

  const startBtn = card.querySelector('[data-action="orj-start-check"]');
  startBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    startBtn.disabled = true;
    try { await handleStartSkillCheck(message); }
    finally { startBtn.disabled = false; }
  });
}
