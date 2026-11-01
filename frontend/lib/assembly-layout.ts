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
