/**
 * Live route preview during drag.
 * Uses a PIXI.Graphics object on canvas.stage so no scene updates happen
 * while the user is still drawing. Committed to scene on drag-end.
 */

let previewContainer = null;

function ensureContainer() {
  if (!canvas.stage) return null;
  if (previewContainer && previewContainer.parent === canvas.stage) return previewContainer;
  // Clean up stale container
  if (previewContainer) {
    try { previewContainer.destroy({ children: true }); } catch (err) {}
  }
  const g = new PIXI.Graphics();
  g.zIndex = 9999;
  canvas.stage.addChild(g);
  previewContainer = g;
  return g;
}

/**
 * Render a dotted preview curve given a list of world-space centers.
 * Called on every pointer-move during drag for instant feedback.
 */
export function renderPreview(centers) {
  const g = ensureContainer();
  if (!g) return;
  g.clear();
  if (!centers || centers.length < 1) return;

  const gridSize = canvas.scene?.grid?.size ?? 100;
  const dotSpacing = Math.max(18, gridSize * 0.22);
  const dotRadius = Math.max(4, gridSize * 0.045);

  // Build smoothed path + sample dots
  const smoothed = smoothPath(centers, 10);
  const dots = resample(smoothed, dotSpacing);

  g.beginFill(0x1a1a1a, 0.85);
  g.lineStyle(1, 0x000000, 0.5);
  for (const p of dots) {
    g.drawCircle(p.x, p.y, dotRadius);
  }
  g.endFill();
}

export function clearPreview() {
  if (previewContainer) {
    previewContainer.clear();
  }
}

// --- helpers (same math as route-planner; kept here to avoid circular import) ---

function smoothPath(centers, samplesPerSegment = 8) {
  if (centers.length < 2) return [...centers];
  const out = [];
  const pt = (i) => centers[Math.max(0, Math.min(centers.length - 1, i))];
  for (let i = 0; i < centers.length - 1; i++) {
    const p0 = pt(i - 1);
    const p1 = pt(i);
    const p2 = pt(i + 1);
    const p3 = pt(i + 2);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      out.push({ x, y });
    }
  }
  out.push(centers[centers.length - 1]);
  return out;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function resample(points, spacing) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = dist(a, b);
    let remaining = segLen - (spacing - carry);
    if (remaining < 0) {
      carry += segLen;
      continue;
    }
    let t = (spacing - carry) / segLen;
    while (t <= 1 + 1e-9) {
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      t += spacing / segLen;
    }
    const lastPlaced = out[out.length - 1];
    carry = dist(lastPlaced, b);
  }
  return out;
}
