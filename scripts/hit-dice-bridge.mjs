/**
 * Bridge to hit-dice-healing module.
 * Uses its public API (HitDiceHealing global) if available.
 * Falls back to our own flags on the actor if not.
 *
 * Burn/regenerate happens via:
 *   - "current" HD (normal spending — handled by hit-dice-healing)
 *   - "burnt" HD (journey-specific — stored in our own flag, regenerated on full rest)
 *
 * For Phase 1 we keep "burnt HD" tracking in OUR flag so the journey module is
 * self-contained. The hit-dice-healing full-rest integration is a Phase 3 task.
 */

import { MODULE_ID } from './journey-data.mjs';

const BURNT_HD_FLAG = 'burntHitDice';
const DRAINED_CONDITION_SLUG = 'drained';

/**
 * Get burnt HD for an actor (our own tracking, separate from hit-dice-healing's current).
 */
export function getBurntHitDice(actor) {
  return actor.getFlag(MODULE_ID, BURNT_HD_FLAG) || 0;
}

export async function burnHitDiceForActor(actor, amount) {
  if (!actor || amount <= 0) return;
  const current = getBurntHitDice(actor);
  await actor.setFlag(MODULE_ID, BURNT_HD_FLAG, current + amount);
}

export async function regenerateBurntHitDiceForActor(actor, amount) {
  if (!actor || amount <= 0) return;
  const current = getBurntHitDice(actor);
  const next = Math.max(0, current - amount);
  await actor.setFlag(MODULE_ID, BURNT_HD_FLAG, next);
}

/**
 * Apply burn to every player-owned character on any scene.
 */
export async function burnHitDiceForAll(amount) {
  const actors = game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner);
  for (const actor of actors) {
    await burnHitDiceForActor(actor, amount);
  }
}

/**
 * Apply Drained condition (PF2E) to an actor.
 * Uses PF2E's built-in condition management.
 */
export async function applyDrainedToActor(actor, value = 1) {
  if (!actor) return;
  try {
    const existing = actor.itemTypes?.condition?.find(c => c.slug === DRAINED_CONDITION_SLUG);
    if (existing) {
      const currentValue = existing.value ?? 0;
      if (value > currentValue) {
        await actor.increaseCondition(DRAINED_CONDITION_SLUG, { value: value - currentValue });
      }
    } else {
      await actor.increaseCondition(DRAINED_CONDITION_SLUG, { value });
    }
  } catch (err) {
    console.warn('One Ring Journey: failed to apply Drained — falling back to flag', err);
    await actor.setFlag(MODULE_ID, 'drained', Math.max(actor.getFlag(MODULE_ID, 'drained') || 0, value));
  }
}
