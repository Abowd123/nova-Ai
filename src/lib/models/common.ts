import { z } from "zod";

export const idSchema = z.string().trim().min(1).max(128);
export const timestampSchema = z.number().int().nonnegative();
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #RRGGBB color");
