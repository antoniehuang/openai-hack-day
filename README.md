# Cosplay Try-On

Upload a photo of yourself and an image of an anime character, and get back a photoreal picture of you wearing their costume. Generation uses OpenAI `gpt-image-2.5-flare` image edits.

## Run it

1. `npm install`
2. `cp .env.example .env.local` and set `OPENAI_API_KEY`.
3. `npm run dev`, then open http://localhost:3000.

Generation takes up to a minute. The API route is `POST /api/tryon` with multipart fields `person` and `character`.
