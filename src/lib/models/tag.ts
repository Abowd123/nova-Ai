import { z } from "zod";
import { hexColorSchema, idSchema, timestampSchema } from "./common";

export const tagSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(50),
  color: hexColorSchema,
  order: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type Tag = z.infer<typeof tagSchema>;

export const tagCreateSchema = z
  .object({ name: z.string().trim().min(1).max(50), color: hexColorSchema.optional() })
  .strict();
export type TagCreateInput = z.input<typeof tagCreateSchema>;

export const tagUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(50), color: hexColorSchema })
  .partial()
  .strict();
export type TagUpdateInput = z.input<typeof tagUpdateSchema>;
