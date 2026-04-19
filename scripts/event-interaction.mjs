/**
 * Handles click interactions on Journey chat cards:
 * - Reveal Event (stage 1 → stage 2)
 * - DC adjust buttons
 * - Start skill check
 * Also applies consequences after the skill check resolves.
 */

import { MODULE_ID, TERRAINS, ROLES, EVENTS, formatDCOffset } from './journey-data.mjs';
import { renderEventStage2, renderEventResult, renderSkillPromptCard } from './chat-cards.mjs';
import { rollEventDie } from './event-roller.mjs';
import { performSkillRoll, handleMarchingRoll, deriveDoSFromTotal } from './marching-test.mjs';
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
 * GM clicked "Skill-Check starten" on a stage-2 event card.
 * Instead of triggering a roll directly (which removes player agency),
 * we post a skill-prompt chat card. The affected player clicks their
 * own skill button there to roll.
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

  const skill1 = role.skills[0];
  const skill2 = role.skills[1];
  const skill1Mod = (affectedActor.skills?.[skill1] ?? affectedActor.perception)?.mod ?? 0;
  const skill2Mod = (affectedActor.skills?.[skill2] ?? affectedActor.perception)?.mod ?? 0;

  const promptId = `event-check-${foundry.utils.randomID()}`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: affectedActor }),
    content: renderSkillPromptCard({
      actor: affectedActor.name,
      role: role.label,
      skill1, skill1Mod, skill2, skill2Mod,
      dc: effectiveDC,
      context: `${event.name} — ${role.label}`,
      flavor: `${affectedActor.name} muss einen Skill-Check machen gegen ${event.name}.`,
      promptId,
    }),
    flags: {
      [MODULE_ID]: {
        promptType: 'event-check',
        promptId,
        actorId: affectedActor.id,
        dc: effectiveDC,
        eventId: flags.eventId,
        roleKey: flags.roleKey,
        parentMessageId: message.id,
      },
    },
  });

  // Mark the stage-2 message as awaiting player roll
  await message.update({
    flags: {
      [MODULE_ID]: {
        ...flags,
        stage: 2.5,
        awaitingPlayerRoll: true,
      },
    },
  });
}

/**
 * Player clicked a skill button on an event-check prompt card.
 * Rolls their chosen skill, applies consequences.
 */
async function handleEventSkillRoll(message, skillKey) {
  const flags = message.flags?.[MODULE_ID];
  if (!flags || flags.promptType !== 'event-check') return;

  const affectedActor = game.actors.get(flags.actorId);
  if (!affectedActor) return;

  if (!affectedActor.isOwner) {
    ui.notifications.warn('Nur der betroffene Spieler kann diesen Check würfeln.');
    return;
  }

  const event = EVENTS[flags.eventId];
  const effectiveDC = flags.dc;

  const rollResult = await performSkillRoll(
    affectedActor,
    skillKey,
    effectiveDC,
    `${event.name}`,
  );
  if (!rollResult) return;

  // Consume the prompt
  try {
    await message.delete();
  } catch (err) {
    await message.update({ flags: { [MODULE_ID]: { ...flags, consumed: true } } });
  }

  const dos = rollResult.degreeOfSuccess ?? deriveDoSFromTotal(rollResult.total, effectiveDC, rollResult.rawRoll);

  await applyConsequences({
    event,
    affectedActor,
    dos,
    skillName: skillKey,
    rollTotal: rollResult.total,
    effectiveDC,
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
      case 1: // Terrible Misfortune → all drained 1 (only assigned roles)
        {
          const roles = canvas.scene?.getFlag(MODULE_ID, 'roles') || {};
          const actorIds = [...new Set(Object.values(roles).filter(Boolean))];
          for (const id of actorIds) {
            const actor = game.actors.get(id);
            if (actor) await applyDrainedToActor(actor, 1);
          }
        }
        consequences.push('Alle (Rollen-Inhaber): Drained 1 (bis volle Rast)');
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

  // Skill-roll buttons on skill-prompt cards (marching test + event check)
  for (const btn of card.querySelectorAll('[data-action="orj-skill-roll"]')) {
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const skillKey = btn.dataset.skill;
      btn.disabled = true;
      try {
        const promptType = message.flags?.[MODULE_ID]?.promptType;
        if (promptType === 'marching-test') {
          await handleMarchingRoll(message, skillKey);
        } else if (promptType === 'event-check') {
          await handleEventSkillRoll(message, skillKey);
        }
      } finally {
        btn.disabled = false;
      }
    });
  }
}
