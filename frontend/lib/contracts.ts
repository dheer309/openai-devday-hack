import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(48).regex(/^[\x20-\x7e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]+$/, "Use a printable Latin-script name.");
export const faceSchema = z.object({
  eyes: z.enum(["round", "sleepy", "happy"]),
  mouth: z.enum(["smile", "neutral", "open"]),
  whiskers: z.boolean(),
  markings: z.enum(["none", "freckles", "forehead_patch"]),
}).strict();
export const designV1Schema = z.object({
  version: z.literal(1), name: nameSchema, shape: z.literal("box"), edge_mm: z.literal(40), face: faceSchema,
}).strict();
export const designV2Schema = z.object({
  version: z.literal(2), name: nameSchema,
  shape: z.enum(["box", "rounded", "diamond", "crystal"]),
  proportions: z.object({ width: z.number().min(0.75).max(1.3), height: z.number().min(0.75).max(1.3), depth: z.number().min(0.75).max(1.3) }).strict(),
  ears: z.enum(["none", "pointed"]), size_mm: z.number().min(40).max(65), face: faceSchema,
}).strict();
export const designSchema = z.discriminatedUnion("version", [designV1Schema, designV2Schema]);
export type DesignSpec = z.infer<typeof designSchema>;
export type DesignV2 = z.infer<typeof designV2Schema>;
export const REQUIRED_CHECKS = ["closed_mesh", "seam_lengths", "seam_labels", "one_tab_per_seam", "no_overlaps", "page_bounds", "label_legibility", "refold_geometry"] as const;
export const V2_REQUIRED_CHECKS = [...REQUIRED_CHECKS, "usable_tabs", "minimum_edge_size", "tab_receiver_fit", "assembly_complexity"] as const;
export function requiredChecks(design: DesignSpec): readonly string[] { return design.version === 2 ? V2_REQUIRED_CHECKS : REQUIRED_CHECKS; }
const assetPath = (filename: string) => z.string().regex(new RegExp(`^/api/assets/([A-Za-z0-9][A-Za-z0-9_-]{0,127})/${filename.replaceAll(".", "\\.")}$`));
const shared = {
  mode: z.literal("supported"), model_url: assetPath("model.glb"), pdf_url: assetPath("net.pdf"), preview_url: assetPath("net.svg"),
  validation: z.object({ status: z.literal("passed"), checks: z.array(z.string()) }).strict(),
};
const v1Result = z.object({ ...shared, design: designV1Schema, stats: z.object({ panel_count: z.literal(6), triangle_count: z.literal(12), page_count: z.literal(1), edge_mm: z.literal(40), paper: z.literal("A4") }).strict() }).strict();
const v2Result = z.object({ ...shared, design: designV2Schema, engine: z.literal("Blender Export Paper Model 1.4.2"), interpretation: z.literal("procedural_low_poly"), stats: z.object({
  panel_count: z.number().int().min(4).max(24), triangle_count: z.number().int().min(4).max(96), page_count: z.literal(1), paper: z.literal("A4"),
  size_mm: z.number().positive().max(65), requested_size_mm: z.number().min(40).max(65), scale_applied: z.number().positive().max(1),
  glue_join_count: z.number().int().min(1).max(18), piece_count: z.number().int().min(1).max(3), minimum_tab_depth_mm: z.number().min(4.498),
}).strict() }).strict();
export const renderResultSchema = z.union([v1Result, v2Result]).superRefine((result, context) => {
  if (!requiredChecks(result.design).every(check => result.validation.checks.includes(check))) context.addIssue({ code: "custom", path: ["validation", "checks"], message: "All print and assembly checks must pass." });
  const id = result.model_url.split("/")[3];
  if (![result.pdf_url, result.preview_url].every(url => url.split("/")[3] === id)) context.addIssue({ code: "custom", path: ["pdf_url"], message: "Model, net, and PDF must belong to the same render." });
  if (result.design.version === 2 && "requested_size_mm" in result.stats && result.stats.requested_size_mm !== result.design.size_mm) context.addIssue({ code: "custom", path: ["stats", "requested_size_mm"], message: "Printed size must correspond to the requested design." });
});
export type RenderResult = z.infer<typeof renderResultSchema>;
export function sameDesign(a: DesignSpec, b: DesignSpec): boolean {
  if (a.version !== b.version || a.name !== b.name || a.shape !== b.shape || a.face.eyes !== b.face.eyes || a.face.mouth !== b.face.mouth || a.face.whiskers !== b.face.whiskers || a.face.markings !== b.face.markings) return false;
  if (a.version === 1 && b.version === 1) return a.edge_mm === b.edge_mm;
  if (a.version === 2 && b.version === 2) return a.ears === b.ears && a.size_mm === b.size_mm && a.proportions.width === b.proportions.width && a.proportions.height === b.proportions.height && a.proportions.depth === b.proportions.depth;
  return false;
}
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.array(z.string()).default([]) }) });
