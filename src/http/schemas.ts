import { z } from "zod";

const generateRequestMessageSchema = z.object({
  role: z.enum(["system", "user"]),
  content: z.string().min(1)
});

export const generateRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(generateRequestMessageSchema).min(1),
  options: z.object({
    thinking: z.boolean().optional()
  }).optional()
});

export type GenerateRequestBody = z.infer<typeof generateRequestSchema>;
