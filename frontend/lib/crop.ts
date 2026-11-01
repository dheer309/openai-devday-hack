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

/** Trim a uniform opaque or transparent border; keep uncertain backgrounds intact. */
export function subjectBounds(data: Uint8ClampedArray, width: number, height: number): CropRect {
  const full = { x: 0, y: 0, width, height };
  if (width < 4 || height < 4 || data.length !== width * height * 4) return full;
  const sample = (x: number, y: number) => (y * width + x) * 4;
  const corner = sample(0, 0);
  const isBackground = (i: number) => {
    if (data[corner + 3] < 16) return data[i + 3] < 16;
    if (data[i + 3] < 16) return false;
    return Math.abs(data[i] - data[corner]) < 18 && Math.abs(data[i + 1] - data[corner + 1]) < 18 && Math.abs(data[i + 2] - data[corner + 2]) < 18;
  };
  let border = 0, matches = 0;
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) { border++; if (isBackground(sample(x, y))) matches++; }
  for (let y = 1; y < height - 1; y++) for (const x of [0, width - 1]) { border++; if (isBackground(sample(x, y))) matches++; }
  if (matches / border < .94) return full;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!isBackground(sample(x, y))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  if (maxX < minX || maxY < minY) return full;
  const pad = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * .12);
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y };
}
