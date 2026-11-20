import { z } from "zod";

export const spriteMaxFrames = 96;
export const spritePackageRequest = z.strictObject({
  clipId: z.uuid(),
  revision: z.int().min(0),
  trackRevision: z.int().min(0),
  startFrame: z.int().min(0).max(35_999),
  endFrame: z.int().min(0).max(35_999),
  pivot: z.strictObject({ x: z.number().min(-4096).max(8192), y: z.number().min(-4096).max(8192) }).optional(),
  loop: z.boolean().default(true),
  filter: z.enum(["nearest", "linear"]).default("nearest"),
  preflight: z.boolean().default(false),
});
