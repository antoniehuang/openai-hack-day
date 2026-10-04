import OpenAI from "openai";

export const maxDuration = 120;

const MAX_BYTES = 20 * 1024 * 1024;

const PROMPT =
  "Image 1 is a real person. Image 2 is an anime character. Create a photorealistic photo of the exact person from image 1 wearing a faithful, high-quality cosplay of the character in image 2: same outfit, colours, accessories, wig/hairstyle and props. Keep the person's face, body and identity unmistakably the same as image 1. Fun convention-photoshoot lighting, clean background.";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function parseImage(form: FormData, field: string): File | string {
  const value = form.get(field);
  if (!(value instanceof File)) return `Missing "${field}" image.`;
  if (!value.type.startsWith("image/")) return `"${field}" must be an image.`;
  if (value.size > MAX_BYTES) return `"${field}" must be under 20MB.`;
  return value;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Expected multipart form data.");
  }

  const person = parseImage(form, "person");
  if (typeof person === "string") return badRequest(person);
  const character = parseImage(form, "character");
  if (typeof character === "string") return badRequest(character);

  try {
    const openai = new OpenAI();
    const result = await openai.images.edit({
      model: "gpt-image-2.5-flare",
      image: [person, character],
      prompt: PROMPT,
      input_fidelity: "high",
      quality: "medium",
      size: "1024x1536",
      output_format: "jpeg",
    });
    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return Response.json({ error: "The model returned no image." }, { status: 500 });
    }
    return Response.json({ image: `data:image/jpeg;base64,${b64}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
