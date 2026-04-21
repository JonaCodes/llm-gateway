import { z } from "zod";

export const generateRequestSchema = z.object({
  model: z.enum(["codex", "gemini"]),
  userPrompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  providerModel: z.string().min(1).optional()
});

export type GenerateRequestBody = z.infer<typeof generateRequestSchema>;
