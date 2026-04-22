import { z } from "zod";

export const generateRequestSchema = z.object({
  model: z.enum(["codex", "codex-app-server", "gemini"]),
  userPrompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  providerModel: z.string().min(1).optional(),
  seedKey: z.string().min(1).optional()
});

export type GenerateRequestBody = z.infer<typeof generateRequestSchema>;

export const codexAppServerSeedRequestSchema = z.object({
  seedKey: z.string().min(1),
  systemPrompt: z.string().min(1),
  providerModel: z.string().min(1).optional()
});

export type CodexAppServerSeedRequestBody = z.infer<typeof codexAppServerSeedRequestSchema>;
