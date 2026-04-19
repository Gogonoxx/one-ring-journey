/**
 * Chat card rendering. Uses native PF2E structure (.pf2e.chat-card, .paizo-style tags)
 * so the cards feel like they belong to the system.
 */

import { MODULE_ID, TERRAINS, ROLES, MARCHING_RESULT, formatDCOffset } from './journey-data.mjs';

function escHtml(s) {
  return foundry.utils.escapeHTML(String(s ?? ''));
}

/**
 * Marching Test result card (after Guide's skill check).
 */
export function renderMarchingTestCard({ guide, terrain, outcome, hexesAdvanced }) {
  const outcomeData = MARCHING_RESULT[outcome];
  const rarityTag = outcomeData.rarity
    ? `<span class="tag ${outcomeData.rarity}">${escHtml(outcomeData.label)}</span>`
    : `<span class="tag">${escHtml(outcomeData.label)}</span>`;

  return `
<div class="pf2e chat-card item-card" data-module="${MODULE_ID}" data-type="marching-test">
  <header class="card-header flexrow">
    <img src="icons/tools/navigation/compass-brass-worn.webp" alt="Marching Test" />
    <h3>${escHtml(guide)} führt die Gruppe</h3>
  </header>
  <section class="tags paizo-style">
    <span class="tag">${escHtml(terrain.label)}</span>
    ${rarityTag}
  </section>
  <section class="card-content">
    <p><strong>${hexesAdvanced}</strong> Hex${hexesAdvanced === 1 ? '' : 'e'} werden zurückgelegt.</p>
  </section>
</div>`.trim();
}

/**
 * Event Stage 1: role revealed, event die still hidden.
 */
export function renderEventStage1({ terrain, role, actorName, messageFlagsJSON }) {
  return `
<div class="pf2e chat-card item-card" data-module="${MODULE_ID}" data-type="event-stage-1"
     data-terrain="${escHtml(terrain.key)}" data-role="${escHtml(role.key)}"
     data-flags='${escHtml(messageFlagsJSON)}'>
  <header class="card-header flexrow">
    <img src="icons/magic/perception/eye-ringed-glow-angry-red.webp" alt="Journey Event" />
    <h3>Journey Event</h3>
  </header>
  <section class="tags paizo-style">
    <span class="tag">${escHtml(terrain.label)}</span>
    <span class="tag rarity uncommon">${escHtml(role.label)}</span>
  </section>
  <section class="card-content">
    <p><strong>${escHtml(actorName)}</strong> (${escHtml(role.label)}) ist betroffen.</p>
    <p><em>Skills: ${role.skills.map(s => escHtml(s.charAt(0).toUpperCase() + s.slice(1))).join(' / ')}</em></p>
  </section>
  <section class="card-buttons">
    <button type="button" data-action="orj-reveal-event">
      <i class="fa-solid fa-dice-d12"></i> Ereignis enthüllen
    </button>
  </section>
</div>`.trim();
}

/**
 * Event Stage 2: event revealed, DC adjust buttons + skill check trigger visible.
 */
export function renderEventStage2({ terrain, role, actorName, event, d12Roll, baseDC, dcOffset, isGM }) {
  const effectiveDC = baseDC + dcOffset;
  const offsetLabel = dcOffset === 0 ? '' : ` (${formatDCOffset(dcOffset)})`;
  const dcAdjustHTML = isGM ? `
  <footer>
    <div class="orj-dc-adjust">
      <span>DC anpassen:</span>
      <button type="button" data-action="orj-dc-adjust" data-delta="-4">−4</button>
      <button type="button" data-action="orj-dc-adjust" data-delta="-2">−2</button>
      <button type="button" data-action="orj-dc-adjust" data-delta="0">±0</button>
      <button type="button" data-action="orj-dc-adjust" data-delta="2">+2</button>
      <button type="button" data-action="orj-dc-adjust" data-delta="4">+4</button>
    </div>
  </footer>` : '';

  const successBonus = event.successBonus
    ? `<p><strong>Bei Erfolg:</strong> ${escHtml(event.successBonus)}</p>`
    : '';

  return `
<div class="pf2e chat-card item-card" data-module="${MODULE_ID}" data-type="event-stage-2"
     data-terrain="${escHtml(terrain.key)}" data-role="${escHtml(role.key)}"
     data-base-dc="${baseDC}" data-dc-offset="${dcOffset}" data-event-id="${event.id}">
  <header class="card-header flexrow">
    <img src="${escHtml(event.icon)}" alt="${escHtml(event.name)}" />
    <h3>${escHtml(event.name)}</h3>
  </header>
  <section class="tags paizo-style">
    <span class="tag">${escHtml(terrain.label)}</span>
    <span class="tag rarity uncommon">${escHtml(role.label)}</span>
    ${event.severity ? `<span class="tag ${escHtml(event.severity)}">d12: ${d12Roll}</span>` : `<span class="tag">d12: ${d12Roll}</span>`}
  </section>
  <section class="card-content">
    <p><em>${escHtml(event.description)}</em></p>
    <hr />
    <p><strong>Betroffen:</strong> ${escHtml(actorName)}</p>
    <p><strong>DC:</strong> ${effectiveDC}${offsetLabel}</p>
    <p><strong>Immer:</strong> ${escHtml(event.alwaysConsequence)}</p>
    <p><strong>Bei Misserfolg:</strong> ${escHtml(event.failConsequence)}</p>
    ${successBonus}
  </section>
  ${dcAdjustHTML}
  <section class="card-buttons">
    <button type="button" data-action="orj-start-check">
      <i class="fa-solid fa-dice-d20"></i> Skill-Check starten
    </button>
  </section>
</div>`.trim();
}

/**
 * Event result summary — after the skill check was rolled.
 */
export function renderEventResult({ event, actorName, skillName, rollTotal, effectiveDC, outcomeLabel, outcomeRarity, consequences }) {
  const consequenceList = consequences.map(c => `<li>${escHtml(c)}</li>`).join('');
  return `
<div class="pf2e chat-card item-card" data-module="${MODULE_ID}" data-type="event-result">
  <header class="card-header flexrow">
    <img src="${escHtml(event.icon)}" alt="${escHtml(event.name)}" />
    <h3>${escHtml(event.name)} — Ergebnis</h3>
  </header>
  <section class="tags paizo-style">
    <span class="tag ${escHtml(outcomeRarity)}">${escHtml(outcomeLabel)}</span>
  </section>
  <section class="card-content">
    <p>${escHtml(actorName)}: ${escHtml(skillName)} <strong>${rollTotal}</strong> vs DC <strong>${effectiveDC}</strong></p>
    <hr />
    <p><strong>Konsequenzen angewendet:</strong></p>
    <ul>${consequenceList}</ul>
  </section>
</div>`.trim();
}

/**
 * Event-hex trigger card — posted when party enters a black hex.
 */
export function renderEventHexCard({ eventNote }) {
  return `
<div class="pf2e chat-card item-card" data-module="${MODULE_ID}" data-type="event-hex">
  <header class="card-header flexrow">
    <img src="icons/magic/symbols/rune-sigil-black-pink.webp" alt="Event Hex" />
    <h3>Event-Hex betreten</h3>
  </header>
  <section class="tags paizo-style">
    <span class="tag rarity rare">Scripted Event</span>
  </section>
  <section class="card-content">
    <p><em>Die Reise wird unterbrochen.</em></p>
    <hr />
    <p>${escHtml(eventNote || '(Keine Notiz — GM, improvisiere!)')}</p>
    <p style="color: var(--color-text-dark-secondary, #555); font-size: 0.9em;">Marching Test abgebrochen. GM übernimmt das Event.</p>
  </section>
</div>`.trim();
}
