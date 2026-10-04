import { fal } from "@fal-ai/client";

export const LUCY_APP = "decart/lucy2-vton/realtime";

export function falKey(): string | null {
  return process.env.FAL_AI_API_KEY || null;
}

export function missingKeyResponse() {
  return Response.json(
    { error: "FAL_AI_API_KEY is not set. Add it to .env.local (or your host's env vars) and restart." },
    { status: 500 },
  );
}

export function configuredFal(key: string) {
  fal.config({ credentials: key });
  return fal;
}
