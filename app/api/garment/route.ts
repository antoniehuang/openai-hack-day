import { configuredFal, falKey, missingKeyResponse } from "@/lib/fal-server";

export const maxDuration = 120;

const GARMENT_MODEL = "fal-ai/nano-banana/edit";
const MAX_BYTES = 20 * 1024 * 1024;

const GARMENT_PROMPT =
  "Turn the outfit worn by this anime character into a real, photographed cosplay costume. Show ONLY the costume (top, bottom, gloves, accessories) laid out flat as a clean product photo on a plain white background, front view, no person, no body, no face, no hair, no text. Keep the exact colours, patterns, trims and materials.";

type FalImages = { images: { url: string }[] };

function isFalImages(data: unknown): data is FalImages {
  if (typeof data !== "object" || data === null || !("images" in data)) return false;
  const { images } = data;
  return Array.isArray(images) && typeof images[0]?.url === "string";
}

export async function POST(request: Request) {
  const key = falKey();
  if (!key) return missingKeyResponse();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("character");
  if (!(file instanceof File)) return Response.json({ error: 'Missing "character" image.' }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "The character must be an image." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "The character image must be under 20MB." }, { status: 400 });

  try {
    const fal = configuredFal(key);
    const characterUrl = await fal.storage.upload(file);
    const result = await fal.subscribe(GARMENT_MODEL, {
      input: { prompt: GARMENT_PROMPT, image_urls: [characterUrl] },
    });
    if (!isFalImages(result.data)) {
      return Response.json({ error: "The costume model returned no image." }, { status: 502 });
    }
    return Response.json({ url: result.data.images[0].url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Costume extraction failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
