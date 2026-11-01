export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;

export type CropRect = { x: number; y: number; width: number; height: number };

/** Integer boundaries preserve every source pixel without leaking into another frame. */
export function frameRect(width: number, height: number, rows: number, columns: number, index: number): CropRect {
  if (![width, height, rows, columns, index].every(Number.isInteger) || width < 1 || height < 1 || rows < 1 || columns < 1 || rows > 16 || columns > 16 || index < 0 || index >= rows * columns || columns > width || rows > height) {
    throw new Error("Choose a valid frame grid and frame.");
  }
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = Math.floor(column * width / columns);
  const y = Math.floor(row * height / rows);
  return {
    x, y,
    width: Math.floor((column + 1) * width / columns) - x,
    height: Math.floor((row + 1) * height / rows) - y,
  };
}

export function outputSize(width: number, height: number, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
