import type { DesignV3 } from "./contracts";

type Part = DesignV3["parts"][number];
type Axis = "x" | "y" | "z";

const axes = ["x", "y", "z"] as const;
const dimension = { x: "width_mm", y: "height_mm", z: "depth_mm" } as const;
const overlap = (a: Part, b: Part, axis: Axis) =>
  (a[dimension[axis]] + b[dimension[axis]]) / 2 - Math.abs(a.position[axis] - b.position[axis]);
const isLimb = (part: Part) => /leg|foot|feet|paw/i.test(part.id);

/** Separate adjacent supported limbs or repeated small siblings without detaching them. */
export function separateFeet(parts: Part[], gap = 4): Part[] {
  const result = parts.map(part => ({ ...part, position: { ...part.position } }));
  const supported = (limb: Part, support: Part) =>
    (support.shape ?? "box") === "box" && !isLimb(support) &&
    Math.abs(overlap(limb, support, "y")) <= .05 && support.position.y > limb.position.y &&
    overlap(limb, support, "x") > 2 && overlap(limb, support, "z") > 2;
  const small = (part: Part, support: Part) =>
    part.width_mm <= support.width_mm * .7 && part.depth_mm <= support.depth_mm * .7;
  const similar = (a: Part, b: Part) => axes.every(axis =>
    Math.abs(a[dimension[axis]] - b[dimension[axis]]) <= Math.max(a[dimension[axis]], b[dimension[axis]]) * .2);
  for (const support of result) {
    const children = result.filter(p => p !== support && supported(p, support));
    const generic = children.filter(p => small(p, support));
    for (const axis of ["x", "z"] as const) {
      const perpendicular = axis === "x" ? "z" : "x";
      const ordered = [...children].sort((a, b) => a.position[axis] - b.position[axis]);
      for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i], b = ordered[j];
        const repeated = generic.length >= 3 && generic.includes(a) && generic.includes(b) && similar(a, b);
        if (!(isLimb(a) && isLimb(b)) && !repeated) continue;
        if (b.position[axis] <= a.position[axis] || overlap(a, b, perpendicular) <= 2 || overlap(a, b, "y") <= 2) continue;
        const currentGap = b.position[axis] - b[dimension[axis]] / 2 - (a.position[axis] + a[dimension[axis]] / 2);
        if (currentGap >= gap || currentGap < -2) continue;
        const move = (gap - currentGap) / 2;
        a.position[axis] -= move; b.position[axis] += move;
        const safe = supported(a, support) && supported(b, support) &&
          Math.abs(a.position[axis]) <= 150 && Math.abs(b.position[axis]) <= 150 &&
          result.every(part => part === a || part === b ||
            [a, b].every(limb => !axes.every(key => overlap(limb, part, key) > .05)));
        if (!safe) { a.position[axis] += move; b.position[axis] -= move; }
      }
    }
  }
  return result;
}

/** Snap nearby disconnected groups together without changing their internal layout. */
export function connectNearParts(parts: Part[], maxMove = 8): Part[] {
  const result = parts.map(part => ({ ...part, position: { ...part.position } }));
  const profile = (part: Part, axis: Axis, along: Axis) => {
    const shape = part.shape ?? "box";
    if (axis === "x" && along === "y") return shape === "diamond" ? 0 : shape === "crystal" ? .3 : shape === "rounded" ? .6 : 1;
    if (axis === "y" && along === "x") return shape === "diamond" ? .32 : shape === "crystal" ? .44 : shape === "rounded" ? .6 : 1;
    return 1;
  };
  const faceOverlap = (a: Part, b: Part, axis: Axis, along: Axis) =>
    (a[dimension[along]] * profile(a, axis, along) + b[dimension[along]] * profile(b, axis, along)) / 2 - Math.abs(a.position[along] - b.position[along]);
  const connected = (a: Part, b: Part) => axes.some(axis =>
    Math.abs(overlap(a, b, axis)) <= .05 && axes.filter(k => k !== axis).every(k => faceOverlap(a, b, axis, k) > 2));
  const component = (start: number) => {
    const found = new Set([start]), queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      result.forEach((part, j) => { if (!found.has(j) && connected(result[i], part)) { found.add(j); queue.push(j); } });
    }
    return found;
  };
  if (result.length < 2) return result;
  // Anchor the largest part and keep all already joined parts together.
  const anchor = result.reduce((best, p, i) => p.width_mm * p.height_mm * p.depth_mm > result[best].width_mm * result[best].height_mm * result[best].depth_mm ? i : best, 0);
  for (let attempt = 0; attempt < result.length; attempt++) {
    const fixed = component(anchor);
    if (fixed.size === result.length) break;
    let best: { group: Set<number>; axis: Axis; delta: number } | undefined;
    for (let i = 0; i < result.length; i++) {
      if (fixed.has(i)) continue;
      const group = component(i);
      for (const j of fixed) for (const axis of axes) {
        const a = result[i], b = result[j];
        if (!axes.filter(k => k !== axis).every(k => faceOverlap(a, b, axis, k) > 2)) continue;
        const half = (a[dimension[axis]] + b[dimension[axis]]) / 2;
        for (const sign of [-1, 1]) {
          const delta = b.position[axis] + sign * half - a.position[axis];
          if (Math.abs(delta) < .001 || Math.abs(delta) > maxMove || (best && Math.abs(delta) >= Math.abs(best.delta))) continue;
          for (const k of group) result[k].position[axis] += delta;
          const safe = [...group].every(k => Math.abs(result[k].position[axis]) <= 150 && result.every((other, n) =>
            group.has(n) || !axes.every(key => overlap(result[k], other, key) > .05)));
          for (const k of group) result[k].position[axis] -= delta;
          if (safe) best = { group, axis, delta };
        }
      }
    }
    if (!best) break;
    for (const k of best.group) result[k].position[best.axis] += best.delta;
  }
  return result;
}
