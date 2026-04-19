/**
 * Event roller — handles d6 (role), d12 (event) rolls with terrain modifiers
 * and Dice So Nice animations for suspenseful timing.
 */

import { MODULE_ID, TERRAINS, EVENTS, ROLES, rollResultToRole } from './journey-data.mjs';

/**
 * Wait for Dice So Nice animation to finish.
 * If DSN not installed, fall back to a short delay.
 */
async function waitForDiceAnimation(roll) {
  if (game.dice3d) {
    // showForRoll returns Promise resolving when dice land
    try {
      await game.dice3d.showForRoll(roll, game.user, true);
    } catch (err) {
      console.warn('One Ring Journey: Dice So Nice animation failed', err);
      await new Promise(r => setTimeout(r, 1500));
    }
  } else {
    await new Promise(r => setTimeout(r, 1500));
  }
}

/**
 * Roll a d6 to determine which role is affected.
 * Awaits dice animation for suspense.
 */
export async function rollAffectedRole() {
  const roll = new Roll('1d6');
  await roll.evaluate();
  await waitForDiceAnimation(roll);
  const total = roll.total;
  const roleKey = rollResultToRole(total);
  return { roll, total, role: ROLES[roleKey] };
}

/**
 * Roll the d12 event die with terrain modifier.
 * Awaits dice animation for suspense.
 */
export async function rollEventDie(terrainKey) {
  const terrain = TERRAINS[terrainKey] ?? TERRAINS.yellow;
  let formula;
  switch (terrain.eventMode) {
    case 'high': formula = '2d12kh1'; break;
    case 'low': formula = '2d12kl1'; break;
    default: formula = '1d12';
  }
  const roll = new Roll(formula);
  await roll.evaluate();
  await waitForDiceAnimation(roll);
  const total = Math.max(1, Math.min(12, roll.total));
  const event = EVENTS[total];
  return { roll, total, event, terrain };
}

/**
 * Get effective DC for a terrain with an optional GM-applied offset.
 */
export function getEffectiveDC(terrainKey, offset = 0) {
  const terrain = TERRAINS[terrainKey] ?? TERRAINS.yellow;
  return (terrain.dc ?? 15) + offset;
}
