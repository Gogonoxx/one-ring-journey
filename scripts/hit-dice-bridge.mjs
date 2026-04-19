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
  const currentBurnt = getBurntHitDice(actor);
  await actor.setFlag(MODULE_ID, BURNT_HD_FLAG, currentBurnt + amount);

  // Also reduce the actor's currently-available hit dice so their pool
  // matches the new effective max. Reading + writing via the hit-dice-healing
  // flag keeps both modules consistent.
  const hddCurrent = actor.getFlag('hit-dice-healing', 'current');
  if (hddCurrent !== undefined && hddCurrent !== null) {
    const newCurrent = Math.max(0, hddCurrent - amount);
    await actor.setFlag('hit-dice-healing', 'current', newCurrent);
  }
}

export async function regenerateBurntHitDiceForActor(actor, amount) {
  if (!actor || amount <= 0) return 0;
  const current = getBurntHitDice(actor);
  const restored = Math.min(current, amount);
  const next = current - restored;
  await actor.setFlag(MODULE_ID, BURNT_HD_FLAG, next);

  // Also bump the actor's currently-available hit dice so the effective max
  // increase is immediately reflected in the pool. Clamp against true max.
  const hddCurrent = actor.getFlag('hit-dice-healing', 'current');
  const level = actor.system?.details?.level?.value ?? 1;
  const trueMax = level + 1;
  if (hddCurrent !== undefined && hddCurrent !== null) {
    const newCurrent = Math.min(trueMax, hddCurrent + restored);
    await actor.setFlag('hit-dice-healing', 'current', newCurrent);
  }
  return restored;
}

/**
 * Decrease Drained condition on an actor by 1 (or remove if at 1).
 */
export async function decreaseDrainedOnActor(actor) {
  if (!actor) return null;
  const existing = actor.itemTypes?.condition?.find(c => c.slug === DRAINED_CONDITION_SLUG);
  if (!existing) return null;
  const currentValue = existing.value ?? 0;
  try {
    if (currentValue <= 1) {
      await actor.decreaseCondition(DRAINED_CONDITION_SLUG, { forceRemove: true });
      return 0;
    } else {
      await actor.decreaseCondition(DRAINED_CONDITION_SLUG);
      return currentValue - 1;
    }
  } catch (err) {
    console.warn('One Ring Journey: failed to decrease Drained', err);
    return null;
  }
}

export function getDrainedValueForActor(actor) {
  if (!actor) return 0;
  const cond = actor.itemTypes?.condition?.find(c => c.slug === DRAINED_CONDITION_SLUG);
  return cond?.value ?? 0;
}

/**
 * Apply burn to the characters currently assigned to the 4 journey roles.
 * Duplicates (same actor in multiple roles) are de-duplicated so they only
 * burn once per event.
 */
export async function burnHitDiceForAll(amount) {
  if (!canvas.scene) return;
  const roles = canvas.scene.getFlag(MODULE_ID, 'roles') || {};
  const actorIds = [...new Set(Object.values(roles).filter(Boolean))];
  for (const id of actorIds) {
    const actor = game.actors.get(id);
    if (actor) await burnHitDiceForActor(actor, amount);
  }
}

/**
 * Apply a pending modifier to the next Marching Test's hex count.
 * +1 for Mishap (route takes 1 extra day/hex), -1 for Short Cut.
 * Stored on the scene so the next marching test can read it.
 */
export async function adjustNextMarchingModifier(delta) {
  if (!canvas.scene) return;
  const current = canvas.scene.getFlag(MODULE_ID, 'nextMarchingModifier') || 0;
  await canvas.scene.setFlag(MODULE_ID, 'nextMarchingModifier', current + delta);
}

export function getNextMarchingModifier() {
  return canvas.scene?.getFlag(MODULE_ID, 'nextMarchingModifier') || 0;
}

export async function clearNextMarchingModifier() {
  if (!canvas.scene) return;
  await canvas.scene.unsetFlag(MODULE_ID, 'nextMarchingModifier');
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
