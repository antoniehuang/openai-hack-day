"use client";

import Image from "next/image";
import { useEffect, useState, type DragEvent } from "react";

type TryOnState =
  | { kind: "idle" }
  | { kind: "generating"; startedAt: number }
  | { kind: "done"; imageDataUrl: string }
  | { kind: "error"; message: string };

type Upload = { file: File; previewUrl: string };

const LOADING_MESSAGES = [
  "Sewing the costume…",
  "Styling the wig…",
  "Summoning the sparkles…",
  "Polishing the props…",
  "Striking a pose…",
];

const CHARACTER_IDEAS = [
  "Sailor Moon",
  "Naruto",
  "Nezuko",
  "Goku",
  "Tanjiro",
  "Asuka",
  "Kiki",
  "Totoro",
];

const sticker =
  "rounded-[2rem] border-4 border-ink bg-white shadow-[6px_6px_0_0_var(--color-ink)]";

function replaceUpload(previous: Upload | null, file: File): Upload {
  if (previous) URL.revokeObjectURL(previous.previewUrl);
  return { file, previewUrl: URL.createObjectURL(file) };
}

function parsePayload(body: unknown): { image?: string; error?: string } {
  if (typeof body !== "object" || body === null) return {};
  const image = "image" in body && typeof body.image === "string" ? body.image : undefined;
  const error = "error" in body && typeof body.error === "string" ? body.error : undefined;
  return { image, error };
}

export function TryOn() {
  const [person, setPerson] = useState<Upload | null>(null);
  const [character, setCharacter] = useState<Upload | null>(null);
  const [state, setState] = useState<TryOnState>({ kind: "idle" });

  const canTransform = person !== null && character !== null && state.kind !== "generating";

  function rejectNonImage() {
    setState({ kind: "error", message: "Oops! That file isn't an image. Try a JPG, PNG or WebP." });
  }

  async function transform() {
    if (!person || !character) return;
    setState({ kind: "generating", startedAt: Date.now() });
    const body = new FormData();
    body.append("person", person.file);
    body.append("character", character.file);
    try {
      const res = await fetch("/api/tryon", { method: "POST", body });
      const payload = parsePayload(await res.json().catch(() => null));
      if (res.ok && payload.image) {
        setState({ kind: "done", imageDataUrl: payload.image });
      } else {
        setState({
          kind: "error",
          message: payload.error ?? `Something went wrong (HTTP ${res.status}).`,
        });
      }
    } catch {
      setState({ kind: "error", message: "Couldn't reach the server. Is it running?" });
    }
  }

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 overflow-hidden px-5 py-10 sm:px-8 sm:py-14">
      <Decorations />

      <header className="relative flex flex-col items-center gap-4 text-center">
        <span className="rotate-[-4deg] rounded-full border-4 border-ink bg-zap px-4 py-1 font-display text-lg font-black shadow-[4px_4px_0_0_var(--color-ink)]">
          コスプレ変身!
        </span>
        <h1 className="font-display text-5xl font-black tracking-tight text-bubblegum [text-shadow:4px_4px_0_var(--color-ink)] sm:text-7xl">
          Cosplay Try-On <span className="inline-block animate-wiggle">✨</span>
        </h1>
        <p className="max-w-xl text-lg font-medium text-ink/80">
          Drop in a photo of you and a picture of your favourite anime character. We&apos;ll
          dress you up in their costume, convention-ready.
        </p>
      </header>

      <section className="relative grid gap-6 sm:grid-cols-2">
        <DropZone
          label="You"
          hint="A clear, front-facing photo works best"
          emoji="🤳"
          upload={person}
          onFile={(file) => setPerson(replaceUpload(person, file))}
          onReject={rejectNonImage}
        />
        <DropZone
          label="Your character"
          hint="Full-body art shows off the whole outfit"
          emoji="🎎"
          upload={character}
          onFile={(file) => setCharacter(replaceUpload(character, file))}
          onReject={rejectNonImage}
        />
      </section>

      <div className="relative flex justify-center">
        <button
          type="button"
          onClick={transform}
          disabled={!canTransform}
          className="rounded-full border-4 border-ink bg-bubblegum px-10 py-4 font-display text-2xl font-black text-white shadow-[6px_6px_0_0_var(--color-ink)] transition hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_var(--color-ink)] active:translate-x-1 active:translate-y-1 active:shadow-[2px_2px_0_0_var(--color-ink)] disabled:cursor-not-allowed disabled:bg-blush disabled:text-ink/50 disabled:hover:translate-y-0 disabled:hover:shadow-[6px_6px_0_0_var(--color-ink)] sm:text-3xl"
        >
          Transform! 変身
        </button>
      </div>

      <ResultPanel state={state} onReset={() => setState({ kind: "idle" })} />

      <section className="relative flex flex-col items-center gap-3">
        <p className="font-display text-base font-bold">Need ideas? Try…</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {CHARACTER_IDEAS.map((name, i) => (
            <li
              key={name}
              className={`rounded-full border-[3px] border-ink px-4 py-1 text-sm font-bold shadow-[3px_3px_0_0_var(--color-ink)] ${
                i % 2 === 0 ? "bg-sky" : "bg-zap"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DropZone({
  label,
  hint,
  emoji,
  upload,
  onFile,
  onReject,
}: {
  label: string;
  hint: string;
  emoji: string;
  upload: Upload | null;
  onFile: (file: File) => void;
  onReject: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  function accept(file: File | undefined) {
    if (!file) return;
    if (file.type.startsWith("image/")) onFile(file);
    else onReject();
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`${sticker} group relative flex aspect-[4/5] cursor-pointer flex-col overflow-hidden transition hover:-translate-y-1 ${
        dragging ? "-translate-y-1 bg-zap" : ""
      }`}
    >
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <span className="absolute left-4 top-4 z-10 rounded-full border-[3px] border-ink bg-bubblegum px-3 py-0.5 font-display text-sm font-black text-white">
        {label}
      </span>
      {upload ? (
        <>
          <Image
            src={upload.previewUrl}
            alt={`${label} preview`}
            fill
            unoptimized
            className="object-cover"
          />
          <span className="absolute bottom-4 right-4 z-10 rounded-full border-[3px] border-ink bg-white px-3 py-0.5 text-sm font-bold opacity-0 transition group-hover:opacity-100">
            Change photo
          </span>
        </>
      ) : (
        <span className="m-4 mt-14 flex flex-1 flex-col items-center justify-center gap-3 rounded-[1.5rem] border-4 border-dashed border-bubblegum/60 bg-blush/40 p-6 text-center">
          <span className="animate-bob text-6xl">{emoji}</span>
          <span className="font-display text-xl font-black">
            {dragging ? "Drop it here!" : "Click or drag a photo"}
          </span>
          <span className="text-sm font-medium text-ink/70">{hint}</span>
        </span>
      )}
    </label>
  );
}

function ResultPanel({ state, onReset }: { state: TryOnState; onReset: () => void }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "generating":
      return <Generating startedAt={state.startedAt} />;
    case "done":
      return (
        <section className={`${sticker} relative mx-auto flex w-full max-w-xl flex-col gap-5 p-5`}>
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[1.5rem] border-4 border-ink">
            <Image
              src={state.imageDataUrl}
              alt="You in cosplay"
              fill
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={state.imageDataUrl}
              download="cosplay-try-on.jpg"
              className="rounded-full border-4 border-ink bg-zap px-6 py-2 font-display text-lg font-black shadow-[4px_4px_0_0_var(--color-ink)] transition hover:-translate-y-0.5"
            >
              Download ⬇
            </a>
            <button
              type="button"
              onClick={onReset}
              className="rounded-full border-4 border-ink bg-sky px-6 py-2 font-display text-lg font-black shadow-[4px_4px_0_0_var(--color-ink)] transition hover:-translate-y-0.5"
            >
              Try another 🔁
            </button>
          </div>
        </section>
      );
    case "error":
      return (
        <section className="relative mx-auto flex w-full max-w-xl items-end gap-3">
          <span className="animate-bob text-5xl">🥺</span>
          <div
            role="alert"
            className="relative flex-1 rounded-[1.5rem] border-4 border-ink bg-white px-5 py-4 font-medium shadow-[5px_5px_0_0_var(--color-ink)] before:absolute before:-left-[14px] before:bottom-4 before:h-5 before:w-5 before:rotate-45 before:border-b-4 before:border-l-4 before:border-ink before:bg-white"
          >
            <p className="font-display font-black text-bubblegum">Gomen ne! ごめんね</p>
            <p className="break-words">{state.message}</p>
          </div>
        </section>
      );
  }
}

function Generating({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const message = LOADING_MESSAGES[Math.floor(elapsed / 3) % LOADING_MESSAGES.length];

  return (
    <section
      aria-live="polite"
      className={`${sticker} relative mx-auto flex w-full max-w-xl flex-col items-center gap-4 bg-blush p-8 text-center`}
    >
      <div className="flex gap-3 text-4xl">
        <span className="animate-bob">🧵</span>
        <span className="animate-bob [animation-delay:200ms]">💇</span>
        <span className="animate-bob [animation-delay:400ms]">✨</span>
      </div>
      <p className="font-display text-2xl font-black">{message}</p>
      <p className="rounded-full border-[3px] border-ink bg-white px-4 py-1 text-sm font-bold tabular-nums">
        {elapsed}s · this usually takes under a minute
      </p>
    </section>
  );
}

function Decorations() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 select-none text-4xl sm:text-5xl">
      <span className="absolute left-[4%] top-[3%] animate-float">🌸</span>
      <span className="absolute right-[6%] top-[6%] animate-float [animation-delay:1s]">⭐</span>
      <span className="absolute left-[2%] top-[42%] animate-float [animation-delay:2s]">🎀</span>
      <span className="absolute right-[3%] top-[55%] animate-float [animation-delay:1.5s]">🌸</span>
      <span className="absolute bottom-[6%] left-[10%] animate-float [animation-delay:0.5s]">⭐</span>
      <span className="absolute bottom-[3%] right-[12%] animate-float [animation-delay:2.5s]">🎀</span>
    </div>
  );
}
