import { z } from "zod";

/** Client-specific domain config (`config.app.json`) — unique per app. */
export const appConfigSchema = z.object({
  // e.g. elections: electionsConfigSchema,
});

export type AppConfig = z.infer<typeof appConfigSchema>;
