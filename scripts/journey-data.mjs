/**
 * Static data for the Journey system:
 * - Roles and their skills
 * - Event table (d12)
 * - Terrain configs (colors, DCs, modifiers)
 */

export const MODULE_ID = 'one-ring-journey';

export const TERRAINS = {
  green: {
    key: 'green',
    label: 'Sicher',
    color: '#2a8a2a',
    alpha: 0.35,
    dc: 14,
    eventMode: 'high', // 2d12 take high
    icon: 'fa-leaf',
  },
  yellow: {
    key: 'yellow',
    label: 'Wildnis',
    color: '#d4a030',
    alpha: 0.35,
    dc: 16,
    eventMode: 'straight', // 1d12
    icon: 'fa-tree',
  },
  red: {
    key: 'red',
    label: 'Feindgebiet',
    color: '#8a2a2a',
    alpha: 0.35,
    dc: 18,
    eventMode: 'low', // 2d12 take low
    icon: 'fa-skull',
  },
  event: {
    key: 'event',
    label: 'Event-Hex',
    color: '#1a1a1a',
    alpha: 0.5,
    dc: null,
    eventMode: null,
    icon: 'fa-bolt',
  },
};

export const ROLES = {
  guide: {
    key: 'guide',
    label: 'Guide',
    skills: ['survival', 'nature'],
  },
  hunter: {
    key: 'hunter',
    label: 'Hunter',
    skills: ['survival', 'athletics'],
  },
  scout: {
    key: 'scout',
    label: 'Scout',
    skills: ['stealth', 'acrobatics'],
  },
  lookout: {
    key: 'lookout',
    label: 'Lookout',
    skills: ['perception', 'society'],
  },
};

// d6 → role mapping for event target
export function rollResultToRole(d6) {
  if (d6 <= 2) return 'scout';
  if (d6 <= 4) return 'lookout';
  return 'hunter';
}

// Marching Test outcome → hexes advanced
export const MARCHING_RESULT = {
  3: { label: 'Crit Success', hexes: 5, rarity: 'rarity rare' },
  2: { label: 'Success', hexes: 3, rarity: 'rarity uncommon' },
  1: { label: 'Failure', hexes: 2, rarity: '' },
  0: { label: 'Crit Failure', hexes: 1, rarity: 'rarity unique' },
};

// d12 Event table — consequences apply based on check outcome
export const EVENTS = [
  null, // index 0 unused (d12 starts at 1)
  {
    id: 1,
    name: 'Terrible Misfortune',
    icon: 'icons/magic/death/skull-horned-worn-fire-blue.webp',
    severity: 'rarity unique',
    hdBurnAll: 2,
    failConsequence: 'Alle werden Drained 1 (bis zur nächsten vollen Rast).',
    alwaysConsequence: 'Alle verlieren 2 HD.',
    description: 'Ein schreckliches Unglück ereilt die Reisenden — ein Sturm, ein Einbruch, eine verhängnisvolle Begegnung.',
  },
  {
    id: 2,
    name: 'Despair',
    icon: 'icons/magic/air/air-smoke-casting.webp',
    severity: 'rarity rare',
    hdBurnAll: 1,
    failConsequence: 'Das Ziel wird Drained 1 (bis zur nächsten vollen Rast).',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Ein dunkler Gedanke, eine Nachricht, ein Gefühl der Aussichtslosigkeit senkt sich über die Gruppe.',
  },
  {
    id: 3,
    name: 'Ill Choices',
    icon: 'icons/environment/wilderness/arch-stone-moss.webp',
    severity: 'rarity rare',
    hdBurnAll: 1,
    failConsequence: 'Das Ziel verliert zusätzlich 1 HD.',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Eine falsche Abzweigung, eine schlechte Entscheidung — die Gruppe zahlt den Preis für ihre Wahl.',
  },
  {
    id: 4,
    name: 'Ill Choices',
    icon: 'icons/environment/wilderness/arch-stone-moss.webp',
    severity: 'rarity rare',
    hdBurnAll: 1,
    failConsequence: 'Das Ziel verliert zusätzlich 1 HD.',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Eine falsche Abzweigung, eine schlechte Entscheidung — die Gruppe zahlt den Preis für ihre Wahl.',
  },
  {
    id: 5,
    name: 'Mishap',
    icon: 'icons/environment/wilderness/tree-pine-oak.webp',
    severity: '',
    hdBurnAll: 1,
    failConsequence: '+1 Tag zur Reise (neuer Marching Test folgt).',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Ein Missgeschick unterwegs — ein Rad bricht, ein Pferd entkommt, ein Weg erweist sich als länger als gedacht.',
  },
  {
    id: 6,
    name: 'Mishap',
    icon: 'icons/environment/wilderness/tree-pine-oak.webp',
    severity: '',
    hdBurnAll: 1,
    failConsequence: '+1 Tag zur Reise (neuer Marching Test folgt).',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Ein Missgeschick unterwegs — ein Rad bricht, ein Pferd entkommt, ein Weg erweist sich als länger als gedacht.',
  },
  {
    id: 7,
    name: 'Mishap',
    icon: 'icons/environment/wilderness/tree-pine-oak.webp',
    severity: '',
    hdBurnAll: 1,
    failConsequence: '+1 Tag zur Reise (neuer Marching Test folgt).',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Ein Missgeschick unterwegs — ein Rad bricht, ein Pferd entkommt, ein Weg erweist sich als länger als gedacht.',
  },
  {
    id: 8,
    name: 'Mishap',
    icon: 'icons/environment/wilderness/tree-pine-oak.webp',
    severity: '',
    hdBurnAll: 1,
    failConsequence: '+1 Tag zur Reise (neuer Marching Test folgt).',
    alwaysConsequence: 'Alle verlieren 1 HD.',
    description: 'Ein Missgeschick unterwegs — ein Rad bricht, ein Pferd entkommt, ein Weg erweist sich als länger als gedacht.',
  },
  {
    id: 9,
    name: 'Short Cut',
    icon: 'icons/environment/settlement/path-dirt.webp',
    severity: 'rarity uncommon',
    hdBurnAll: 0,
    failConsequence: 'Keine Konsequenz.',
    alwaysConsequence: 'Kein HD-Verlust.',
    successBonus: 'Die Reise verkürzt sich um 1 Tag.',
    description: 'Ein kürzerer Pfad offenbart sich — wenn die Gruppe ihn zu nutzen weiß.',
  },
  {
    id: 10,
    name: 'Short Cut',
    icon: 'icons/environment/settlement/path-dirt.webp',
    severity: 'rarity uncommon',
    hdBurnAll: 0,
    failConsequence: 'Keine Konsequenz.',
    alwaysConsequence: 'Kein HD-Verlust.',
    successBonus: 'Die Reise verkürzt sich um 1 Tag.',
    description: 'Ein kürzerer Pfad offenbart sich — wenn die Gruppe ihn zu nutzen weiß.',
  },
  {
    id: 11,
    name: 'Chance Meeting',
    icon: 'icons/environment/people/commoner.webp',
    severity: 'rarity uncommon',
    hdBurnAll: 0,
    failConsequence: 'Keine Konsequenz.',
    alwaysConsequence: 'Kein HD-Verlust.',
    successBonus: 'Eine positive Begegnung — der GM improvisiert.',
    description: 'Auf dem Weg trifft die Gruppe auf jemanden — ob Freund oder flüchtiger Gefährte, wird sich zeigen.',
  },
  {
    id: 12,
    name: 'Joyful Discovery',
    icon: 'icons/magic/holy/yin-yang-balance-symbol.webp',
    severity: 'rarity rare',
    hdBurnAll: 0,
    failConsequence: 'Keine Konsequenz.',
    alwaysConsequence: 'Kein HD-Verlust.',
    successBonus: 'Alle regenerieren entweder Drained -1 ODER 2 verbrannte HD.',
    description: 'Ein unerwartetes Licht im Dunkel — eine Quelle, ein Heiligtum, ein stiller Ort der Ruhe.',
  },
];

// Format DC offset for display (e.g. +2 / -4 / ±0)
export function formatDCOffset(offset) {
  if (offset === 0) return '±0';
  return offset > 0 ? `+${offset}` : `${offset}`;
}
