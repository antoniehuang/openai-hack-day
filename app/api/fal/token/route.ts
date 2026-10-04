import { falKey, missingKeyResponse } from "@/lib/fal-server";

const TOKEN_SECONDS = 600;

export async function POST() {
  const key = falKey();
  if (!key) return missingKeyResponse();

  const res = await fetch("https://rest.fal.ai/tokens/", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_apps: ["lucy2-vton"], token_expiration: TOKEN_SECONDS }),
  });
  if (!res.ok) {
    return Response.json({ error: `fal token request failed (${res.status}): ${await res.text()}` }, { status: 502 });
  }
  const token: unknown = await res.json();
  if (typeof token !== "string") {
    return Response.json({ error: "fal returned an unexpected token payload." }, { status: 502 });
  }
  return Response.json({ token });
}
