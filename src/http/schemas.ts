import { z } from "zod";

export const generateRequestSchema = z.object({
  model: z.enum(["codex", "codex-app-server", "gemini", "gemma4-e2b", "gemma4-e4b"]),
  userPrompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  providerModel: z.string().min(1).optional(),
  options: z.object({
    thinking: z.boolean().optional()
  }).optional()
});

export type GenerateRequestBody = z.infer<typeof generateRequestSchema>;
