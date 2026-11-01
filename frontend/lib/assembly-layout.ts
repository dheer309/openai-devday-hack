import type { DesignV3 } from "./contracts";

type Part = DesignV3["parts"][number];

// Keep separate left/right feet visibly separate while both remain glued to a
// common support. Never change a layout if the proposed move is unbuildable.
export function separateFeet(parts: Part[], gap = 4): Part[] {
  const result = parts.map(part => ({ ...part, position: { ...part.position } }));
  const side = (part: Part, name: "left" | "right") => {
    const id = part.id.toLowerCase();
    return id.includes(name) && (id.includes("foot") || id.includes("feet") || id.includes("leg"));
  };
  const left = result.find(part => side(part, "left"));
  const right = result.find(part => side(part, "right"));
  if (!left || !right || left.position.x >= right.position.x) return result;
  const currentGap = right.position.x - right.width_mm / 2 - (left.position.x + left.width_mm / 2);
  if (currentGap >= gap) return result;
  const overlaps = (a: Part, b: Part, axis: "x" | "y" | "z") => {
    const dim = axis === "x" ? "width_mm" : axis === "y" ? "height_mm" : "depth_mm";
    return (a[dim] + b[dim]) / 2 - Math.abs(a.position[axis] - b.position[axis]);
  };
  const supported = (foot: Part, support: Part) =>
    Math.abs(overlaps(foot, support, "y")) <= .05 &&
    support.position.y > foot.position.y && overlaps(foot, support, "x") > 2 && overlaps(foot, support, "z") > 2;
  const support = result.find(p => p !== left && p !== right && supported(left, p) && supported(right, p));
  if (!support) return result;
  const move = (gap - currentGap) / 2;
  left.position.x -= move;
  right.position.x += move;
  const safe = supported(left, support) && supported(right, support) &&
    Math.abs(left.position.x) <= 150 && Math.abs(right.position.x) <= 150 &&
    result.every(part => part === left || part === right ||
      [left, right].every(foot => !(["x", "y", "z"] as const).every(axis => overlaps(foot, part, axis) > .05)));
  if (!safe) { left.position.x += move; right.position.x -= move; }
  return result;
}
