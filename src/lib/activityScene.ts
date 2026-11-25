// The Claude activity animation (ClaudeActivity), drawn on a canvas frame by frame: a particle
// cloud that circles a pulsing core while claude thinks, and resolves into a check when it
// finishes. Positions are pure functions of time, so a frame needs no state of its own.

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** The scene is drawn in a 64×64 box. */
export const SCENE = 64;
const CX = 32, CY = 33, TILT = 0.52;

interface Particle { a: number; sp: number; r: number; wob: number; f: number; ph: number; hue: number }

const N = 26;
const particles: Particle[] = Array.from({ length: N }, (_, i) => ({
  a: (i / N) * TAU + Math.sin(i * 7.1) * 0.4,
  sp: 0.55 + ((i * 37) % 11) / 22,
  r: 11 + ((i * 53) % 9),
  wob: 1.5 + ((i * 29) % 5) * 0.6,
  f: 0.7 + ((i * 17) % 7) / 6,
  ph: i * 1.37,
  hue: i / N,
}));

/** Where a particle is: an orbit tilted toward the viewer, breathing in and out. */
function orbit(p: Particle, time: number) {
  const a = p.a + time * p.sp;
  const r = p.r + Math.sin(time * p.f + p.ph) * p.wob;
  const z = Math.sin(a);
  return { x: CX + Math.cos(a) * r, y: CY + z * r * TILT + Math.sin(time * 0.9 + p.ph) * 1.2, z };
}

/** Claude orange to peach to lavender across the cloud. */
function color(h: number, alpha: number): string {
  const c = h < 0.5
    ? [217 + 38 * h * 2, 119 + 71 * h * 2, 87 + 73 * h * 2]
    : [255 - 58 * (h - 0.5) * 2, 190 - 22 * (h - 0.5) * 2, 160 + 95 * (h - 0.5) * 2];
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${alpha})`;
}

function core(g: CanvasRenderingContext2D, time: number, energy: number, inner: string, outer: string) {
  const r = 11 * (1 + Math.sin(time * 3.2) * 0.12 * energy);
  const cg = g.createRadialGradient(CX, CY, 0, CX, CY, r);
  cg.addColorStop(0, inner);
  cg.addColorStop(0.35, outer);
  cg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = cg;
  g.beginPath();
  g.arc(CX, CY, r, 0, TAU);
  g.fill();
}

/** Thinking: the cloud circles the core; near particles link, each leaves a short trail. */
export function drawThinking(g: CanvasRenderingContext2D, time: number) {
  g.lineCap = "round";
  [[7.5, 1.1, 0.9], [10, -0.7, 1.4]].forEach(([r, sp, len], k) => {
    const a = time * sp + k * 2;
    const ag = g.createLinearGradient(CX - r, CY, CX + r, CY);
    ag.addColorStop(0, "rgba(255, 190, 160, 0)");
    ag.addColorStop(1, "rgba(255, 190, 160, 0.55)");
    g.strokeStyle = ag;
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(CX, CY, r, r * 0.92, 0, a, a + len);
    g.stroke();
  });
  core(g, time, 1, "rgba(255, 236, 222, 0.95)", "rgba(217, 119, 87, 0.45)");
  const pos = particles.map((p) => ({ p, ...orbit(p, time) }));
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y);
      if (d >= 8.5) continue;
      g.strokeStyle = `rgba(255, 210, 190, ${(1 - d / 8.5) * 0.28 * (0.6 + 0.2 * (pos[i].z + pos[j].z))})`;
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(pos[i].x, pos[i].y);
      g.lineTo(pos[j].x, pos[j].y);
      g.stroke();
    }
  }
  // Back to front, sized and lit by depth.
  pos.sort((a, b) => a.z - b.z).forEach(({ p, x, y, z }) => {
    const depth = (z + 1) / 2;
    for (let k = 5; k >= 1; k--) {
      const q = orbit(p, time - k * 0.035);
      g.fillStyle = color(p.hue, (0.18 - k * 0.03) * (0.4 + depth));
      g.beginPath();
      g.arc(q.x, q.y, 0.5 + depth * 0.6, 0, TAU);
      g.fill();
    }
    const s = 0.7 + depth * 1.1;
    const glow = g.createRadialGradient(x, y, 0, x, y, s * 2.6);
    glow.addColorStop(0, color(p.hue, 0.5 * (0.4 + depth)));
    glow.addColorStop(1, color(p.hue, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, s * 2.6, 0, TAU);
    g.fill();
    g.fillStyle = color(p.hue, 0.55 + depth * 0.45);
    g.beginPath();
    g.arc(x, y, s, 0, TAU);
    g.fill();
  });
}

/** Finished, on a timeline (seconds since it began): the cloud gathers into the core, a flash,
 *  rings ripple out, a check draws itself, and the particles settle into a green halo. */
export function drawFinished(g: CanvasRenderingContext2D, time: number) {
  const gather = easeInOutSine(clamp(time / 0.6, 0, 1));
  const since = time - 0.6;
  const flash = since > 0 ? Math.exp(-since * 6) : 0;
  const green = clamp(since / 0.4, 0, 1);
  core(g, time, 1 - green * 0.7, "rgba(255, 255, 255, 0.95)", green > 0 ? `rgba(108, 209, 123, ${0.35 + flash * 0.4})` : `rgba(217, 119, 87, ${0.45 + gather * 0.3})`);
  if (flash > 0.01) {
    g.fillStyle = `rgba(255, 255, 255, ${flash * 0.7})`;
    g.beginPath();
    g.arc(CX, CY, 6 + (1 - flash) * 6, 0, TAU);
    g.fill();
  }
  [0, 0.18].forEach((d) => {
    const t = since - d;
    if (t <= 0 || t >= 1.1) return;
    const p = easeOutCubic(t / 1.1);
    g.strokeStyle = `rgba(108, 209, 123, ${0.6 * (1 - t / 1.1)})`;
    g.lineWidth = 1.4 * (1 - p) + 0.3;
    g.beginPath();
    g.arc(CX, CY, 6 + p * 22, 0, TAU);
    g.stroke();
  });
  particles.forEach((p, i) => {
    let x: number, y: number, size: number;
    if (since <= 0) {
      const o = orbit(p, 2 + time * 1.5);
      const k = gather * gather;
      x = o.x + (CX - o.x) * k;
      y = o.y + (CY - o.y) * k;
      size = 1.2 - k * 0.5;
      g.fillStyle = color(p.hue, 0.9);
    } else {
      const out = easeOutBack(clamp((since - 0.1 - (i % 5) * 0.03) / 0.7, 0, 1), 1.3);
      const ang = p.a + time * 0.25;
      const r = out * (20 + (i % 3) * 1.5);
      x = CX + Math.cos(ang) * r;
      y = CY + Math.sin(ang) * r * 0.9;
      size = 0.55 + (i % 3) * 0.2;
      g.fillStyle = `rgba(160, 235, 175, ${0.25 + 0.45 * out * (0.6 + 0.4 * Math.sin(time * 2 + i))})`;
    }
    g.beginPath();
    g.arc(x, y, size, 0, TAU);
    g.fill();
  });
  // The check draws itself in one stroke.
  const draw = clamp((since - 0.15) / 0.4, 0, 1);
  if (draw <= 0) return;
  const pts: [number, number][] = [[CX - 6, CY + 0.5], [CX - 1.8, CY + 4.6], [CX + 6.4, CY - 4.4]];
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const len = easeOutCubic(draw) * (l1 + l2);
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const [w, col] of [[4.5, "rgba(108, 209, 123, 0.25)"], [2.2, "#ffffff"]] as const) {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(...pts[0]);
    if (len <= l1) {
      g.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * (len / l1), pts[0][1] + (pts[1][1] - pts[0][1]) * (len / l1));
    } else {
      const q = (len - l1) / l2;
      g.lineTo(...pts[1]);
      g.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * q, pts[1][1] + (pts[2][1] - pts[1][1]) * q);
    }
    g.stroke();
  }
}
