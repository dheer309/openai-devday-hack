import { z } from "zod";

export const designSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(48).regex(/^[^\u0000-\u001f\u007f]+$/, "Use a plain display name."),
  shape: z.literal("box"),
  edge_mm: z.literal(40),
  face: z.object({
    eyes: z.enum(["round", "sleepy", "happy"]),
    mouth: z.enum(["smile", "neutral", "open"]),
    whiskers: z.boolean(),
    markings: z.enum(["none", "freckles", "forehead_patch"]),
  }).strict(),
}).strict();

export type DesignSpec = z.infer<typeof designSchema>;

export const REQUIRED_CHECKS = [
  "closed_mesh", "seam_lengths", "seam_labels", "one_tab_per_seam",
  "no_overlaps", "page_bounds", "label_legibility", "refold_geometry",
] as const;

// Assets must come from the local geometry proxy and one render, never arbitrary URLs.
const assetPath = (filename: string) => z.string().regex(
  new RegExp(`^/api/assets/([A-Za-z0-9][A-Za-z0-9_-]{0,127})/${filename.replaceAll(".", "\\.")}$`),
);

export const renderResultSchema = z.object({
  design: designSchema,
  mode: z.literal("supported"),
  model_url: assetPath("model.glb"),
  pdf_url: assetPath("net.pdf"),
  preview_url: assetPath("net.svg"),
  validation: z.object({
    status: z.literal("passed"),
    checks: z.array(z.string()).refine(
      (checks) => REQUIRED_CHECKS.every((check) => checks.includes(check)),
      "All print validation checks must pass.",
    ),
  }).strict(),
  stats: z.object({
    panel_count: z.literal(6), triangle_count: z.literal(12),
    page_count: z.literal(1), edge_mm: z.literal(40), paper: z.literal("A4"),
  }).strict(),
}).strict().refine((result) => {
  const id = result.model_url.split("/")[3];
  return [result.pdf_url, result.preview_url].every((url) => url.split("/")[3] === id);
}, "Model, net, and PDF must belong to the same render.");

export type RenderResult = z.infer<typeof renderResultSchema>;

export function sameDesign(a: DesignSpec, b: DesignSpec): boolean {
  return a.version === b.version && a.name === b.name && a.shape === b.shape &&
    a.edge_mm === b.edge_mm && a.face.eyes === b.face.eyes &&
    a.face.mouth === b.face.mouth && a.face.whiskers === b.face.whiskers &&
    a.face.markings === b.face.markings;
}

export const errorSchema = z.object({
  error: z.object({
    code: z.string(), message: z.string(), details: z.array(z.string()).default([]),
  }),
});
