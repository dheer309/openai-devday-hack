import type { DesignV3 } from "./contracts";

/** World-space bounds in metres, matching the exported scaled GLB and PDF. */
export function assemblyBounds(design: DesignV3, scale: number) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of design.parts) {
    const centers = [part.position.x, part.position.y, part.position.z];
    const sizes = [part.width_mm, part.height_mm, part.depth_mm];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], (centers[axis] - sizes[axis] / 2) * scale / 1000);
      max[axis] = Math.max(max[axis], (centers[axis] + sizes[axis] / 2) * scale / 1000);
    }
  }
  return { min, max };
}
