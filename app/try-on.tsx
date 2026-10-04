"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { connectLucy, DEFAULT_PROMPT, type LucyHandle, type LucyStatus } from "@/lib/lucy";

type Upload = { file: File; previewUrl: string };

type Camera =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  | { kind: "denied"; message: string };

type Garment =
  | { kind: "none" }
  | { kind: "extracting"; startedAt: number }
  | { kind: "ready"; url: string }
  | { kind: "failed"; message: string };

type Session =
  | { kind: "idle" }
  | { kind: "connecting"; status: LucyStatus }
  | { kind: "live"; output: MediaStream | null }
  | { kind: "error"; message: string };

const EXTRACT_MESSAGES = [
  "Sewing the costume…",
  "Ironing the pleats…",
  "Polishing the props…",
  "Summoning the sparkles…",
];

const CHARACTER_IDEAS = ["Sailor Moon", "Naruto", "Nezuko", "Goku", "Tanjiro", "Asuka", "Kiki", "Luffy"];

const sticker = "rounded-[2rem] border-4 border-ink bg-white shadow-[6px_6px_0_0_var(--color-ink)]";

const chunkyButton =
  "rounded-full border-4 border-ink font-display font-black shadow-[4px_4px_0_0_var(--color-ink)] transition hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-[1px_1px_0_0_var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

function replaceUpload(previous: Upload | null, file: File): Upload {
  if (previous) URL.revokeObjectURL(previous.previewUrl);
  return { file, previewUrl: URL.createObjectURL(file) };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function errorText(body: Record<string, unknown>, status: number): string {
  return typeof body.error === "string" ? body.error : `Something went wrong (HTTP ${status}).`;
}

function useVideoStream(stream: MediaStream | null, onElement?: (el: HTMLVideoElement | null) => void) {
  return useCallback(
    (el: HTMLVideoElement | null) => {
      onElement?.(el);
      if (el && el.srcObject !== stream) el.srcObject = stream;
    },
    [stream, onElement],
  );
}

export function TryOn() {
  const [character, setCharacter] = useState<Upload | null>(null);
  const [garment, setGarment] = useState<Garment>({ kind: "none" });
  const [camera, setCamera] = useState<Camera>({ kind: "off" });
  const [session, setSession] = useState<Session>({ kind: "idle" });
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [snap, setSnap] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const lucy = useRef<LucyHandle | null>(null);
  const extraction = useRef(0);

  const cameraStream = camera.kind === "on" ? camera.stream : null;
  const outputStream = session.kind === "live" ? session.output : null;
  const localVideo = useVideoStream(cameraStream);
  const outputEl = useRef<HTMLVideoElement | null>(null);
  const rememberOutput = useCallback((el: HTMLVideoElement | null) => {
    outputEl.current = el;
  }, []);
  const outputVideo = useVideoStream(outputStream, rememberOutput);

  useEffect(() => () => lucy.current?.close(), []);

  function addLog(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 80));
  }

  async function extract(file: File) {
    const id = ++extraction.current;
    setGarment({ kind: "extracting", startedAt: Date.now() });
    const body = new FormData();
    body.append("character", file);
    try {
      const res = await fetch("/api/garment", { method: "POST", body });
      const json = await readJson(res);
      if (id !== extraction.current) return;
      if (res.ok && typeof json.url === "string") {
        setGarment({ kind: "ready", url: json.url });
        lucy.current?.setState({ prompt, reference_image_url: json.url });
        addLog(`costume ready ${json.url}`);
      } else {
        setGarment({ kind: "failed", message: errorText(json, res.status) });
      }
    } catch {
      if (id === extraction.current) setGarment({ kind: "failed", message: "Couldn't reach the server." });
    }
  }

  function chooseCharacter(file: File) {
    setCharacter((prev) => replaceUpload(prev, file));
    void extract(file);
  }

  async function startCamera() {
    setCamera({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      setCamera({ kind: "on", stream });
    } catch (e) {
      setCamera({
        kind: "denied",
        message: e instanceof Error ? e.message : "Camera permission was denied.",
      });
    }
  }

  async function goLive() {
    if (camera.kind !== "on" || garment.kind !== "ready") return;
    setSnap(null);
    setSession({ kind: "connecting", status: "connecting" });
    try {
      const res = await fetch("/api/fal/token", { method: "POST" });
      const json = await readJson(res);
      if (!res.ok || typeof json.token !== "string") {
        setSession({ kind: "error", message: errorText(json, res.status) });
        return;
      }
      lucy.current?.close();
      lucy.current = connectLucy({
        token: json.token,
        stream: camera.stream,
        initial: { prompt, reference_image_url: garment.url },
        onTrack: (output) => setSession({ kind: "live", output }),
        onStatus: (status, detail) => {
          addLog(`status ${status}${detail ? `: ${detail}` : ""}`);
          if (status === "error") setSession({ kind: "error", message: detail ?? "Live session failed." });
          else if (status === "closed") setSession({ kind: "idle" });
          else if (status !== "live") setSession((s) => (s.kind === "live" ? s : { kind: "connecting", status }));
        },
        onMessage: (msg) => addLog(`← ${JSON.stringify(msg).slice(0, 300)}`),
      });
    } catch {
      setSession({ kind: "error", message: "Couldn't reach the server." });
    }
  }

  function stopLive() {
    lucy.current?.close();
    lucy.current = null;
    setSession({ kind: "idle" });
  }

  function sendPrompt() {
    if (garment.kind !== "ready") return;
    lucy.current?.setState({ prompt, reference_image_url: garment.url });
    addLog(`→ prompt ${prompt}`);
  }

  function takeSnap() {
    const video = outputEl.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setSnap(canvas.toDataURL("image/jpeg", 0.92));
  }

  const canGoLive = camera.kind === "on" && garment.kind === "ready" && session.kind !== "connecting";
  const isLive = session.kind === "live" || session.kind === "connecting";

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 overflow-hidden px-5 py-10 sm:px-8 sm:py-14">
      <Decorations />

      <header className="relative flex flex-col items-center gap-4 text-center">
        <span className="rotate-[-4deg] rounded-full border-4 border-ink bg-zap px-4 py-1 font-display text-lg font-black shadow-[4px_4px_0_0_var(--color-ink)]">
          ライブ コスプレ変身!
        </span>
        <h1 className="font-display text-5xl font-black tracking-tight text-bubblegum [text-shadow:4px_4px_0_var(--color-ink)] sm:text-7xl">
          Cosplay Mirror <span className="inline-block animate-wiggle">✨</span>
        </h1>
        <p className="max-w-xl text-lg font-medium text-ink/80">
          Drop in your favourite anime character, switch on your camera, and watch yourself
          wear their costume live. Move, spin, strike a pose!
        </p>
      </header>

      <section className="relative grid gap-6 md:grid-cols-[1fr_1fr_1.6fr]">
        <Step n={1} title="Pick a character">
          <DropZone
            label="Character"
            hint="Full-body, front-facing art works best"
            emoji="🎎"
            upload={character}
            onFile={chooseCharacter}
            onReject={() => setGarment({ kind: "failed", message: "That file isn't an image. Try a JPG, PNG or WebP." })}
          />
        </Step>

        <Step n={2} title="Costume workshop">
          <CostumeCard garment={garment} onRetry={character ? () => void extract(character.file) : undefined} />
        </Step>

        <Step n={3} title="Mirror mirror">
          <div className={`${sticker} relative aspect-[4/3] overflow-hidden bg-ink`}>
            {session.kind === "live" && outputStream ? (
              <video ref={outputVideo} autoPlay playsInline muted className="h-full w-full object-cover" />
            ) : cameraStream ? (
              <video ref={localVideo} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-blush p-6 text-center">
                <span className="animate-bob text-6xl">🪞</span>
                <p className="font-display text-xl font-black">Your magic mirror</p>
                {camera.kind === "denied" && (
                  <p className="text-sm font-bold text-bubblegum">Camera blocked: {camera.message}</p>
                )}
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={camera.kind === "starting"}
                  className={`${chunkyButton} bg-sky px-6 py-2 text-lg`}
                >
                  {camera.kind === "starting" ? "Waking camera…" : "Start camera 📷"}
                </button>
              </div>
            )}
            {session.kind === "live" && cameraStream && (
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                className="absolute bottom-3 right-3 w-1/4 scale-x-[-1] rounded-xl border-[3px] border-white shadow-lg"
              />
            )}
            {session.kind === "connecting" && <Overlay text={`Opening the portal… (${session.status})`} />}
            {session.kind === "live" && (
              <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full border-[3px] border-ink bg-bubblegum px-3 py-0.5 font-display text-sm font-black text-white">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-zap" /> LIVE
              </span>
            )}
          </div>
        </Step>
      </section>

      <div className="relative flex flex-wrap items-center justify-center gap-4">
        {isLive ? (
          <>
            <button type="button" onClick={stopLive} className={`${chunkyButton} bg-white px-8 py-3 text-xl`}>
              Stop ⏹
            </button>
            <button
              type="button"
              onClick={takeSnap}
              disabled={session.kind !== "live"}
              className={`${chunkyButton} bg-zap px-8 py-3 text-xl`}
            >
              Snap! 📸
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={goLive}
            disabled={!canGoLive}
            className={`${chunkyButton} bg-bubblegum px-10 py-4 text-2xl text-white sm:text-3xl`}
          >
            Go live! 変身
          </button>
        )}
      </div>
      {!isLive && !canGoLive && (
        <p className="relative -mt-6 text-center text-sm font-bold text-ink/70">
          {garment.kind !== "ready" ? "Pick a character and wait for the costume to be stitched. " : ""}
          {camera.kind !== "on" ? "Switch on your camera." : ""}
        </p>
      )}

      {session.kind === "error" && <Bubble message={session.message} />}

      {isLive && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt();
          }}
          className={`${sticker} relative mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 sm:flex-row`}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 rounded-full border-[3px] border-ink px-4 py-2 font-medium outline-none focus:bg-blush/40"
            aria-label="Costume prompt"
          />
          <button type="submit" className={`${chunkyButton} bg-sky px-6 py-2`}>
            Re-style 🎨
          </button>
        </form>
      )}

      {snap && (
        <section className={`${sticker} relative mx-auto flex w-full max-w-md rotate-[-2deg] flex-col gap-4 p-4 pb-6`}>
          <Image src={snap} alt="Your cosplay snapshot" width={640} height={480} unoptimized className="w-full rounded-xl border-4 border-ink" />
          <div className="flex justify-center gap-3">
            <a href={snap} download="cosplay-mirror.jpg" className={`${chunkyButton} bg-zap px-6 py-2 text-lg`}>
              Download ⬇
            </a>
            <button type="button" onClick={() => setSnap(null)} className={`${chunkyButton} bg-white px-6 py-2 text-lg`}>
              Close
            </button>
          </div>
        </section>
      )}

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

      <details className="relative mx-auto w-full max-w-3xl text-xs">
        <summary className="cursor-pointer text-center font-bold text-ink/60">🐛 debug</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-xl border-2 border-ink bg-white/80 p-3 whitespace-pre-wrap">
          {log.join("\n") || "No messages yet."}
        </pre>
      </details>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-display text-xl font-black">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-ink bg-zap">{n}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Overlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/60 text-center text-white">
      <span className="animate-spin text-5xl [animation-duration:2s]">🌸</span>
      <p className="font-display text-xl font-black">{text}</p>
    </div>
  );
}

function Bubble({ message }: { message: string }) {
  return (
    <section className="relative mx-auto flex w-full max-w-xl items-end gap-3">
      <span className="animate-bob text-5xl">🥺</span>
      <div
        role="alert"
        className="relative flex-1 rounded-[1.5rem] border-4 border-ink bg-white px-5 py-4 font-medium shadow-[5px_5px_0_0_var(--color-ink)] before:absolute before:-left-[14px] before:bottom-4 before:h-5 before:w-5 before:rotate-45 before:border-b-4 before:border-l-4 before:border-ink before:bg-white"
      >
        <p className="font-display font-black text-bubblegum">Gomen ne! ごめんね</p>
        <p className="break-words">{message}</p>
      </div>
    </section>
  );
}

function CostumeCard({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  return (
    <div className={`${sticker} relative flex aspect-[4/5] flex-col overflow-hidden`}>
      <GarmentBody garment={garment} onRetry={onRetry} />
    </div>
  );
}

function GarmentBody({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  switch (garment.kind) {
    case "none":
      return (
        <div className="m-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-[1.5rem] border-4 border-dashed border-sky bg-sky/20 p-6 text-center">
          <span className="text-6xl">🧵</span>
          <p className="font-display text-lg font-black">Waiting for a character</p>
          <p className="text-sm font-medium text-ink/70">We&apos;ll stitch a real-life costume from the art.</p>
        </div>
      );
    case "extracting":
      return <Stitching startedAt={garment.startedAt} />;
    case "ready":
      return (
        <>
          <Image src={garment.url} alt="Extracted costume" fill unoptimized className="object-contain p-2" />
          <span className="absolute left-4 top-4 rounded-full border-[3px] border-ink bg-zap px-3 py-0.5 font-display text-sm font-black">
            Costume ready! ✅
          </span>
        </>
      );
    case "failed":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-blush p-6 text-center">
          <span className="text-5xl">😵‍💫</span>
          <p className="font-display text-lg font-black">The sewing machine jammed</p>
          <p className="break-words text-sm font-medium">{garment.message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={`${chunkyButton} bg-sky px-5 py-1.5`}>
              Try again 🔁
            </button>
          )}
        </div>
      );
  }
}

function Stitching({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <div aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-4 bg-blush p-6 text-center">
      <div className="flex gap-3 text-4xl">
        <span className="animate-bob">🧵</span>
        <span className="animate-bob [animation-delay:200ms]">✂️</span>
        <span className="animate-bob [animation-delay:400ms]">✨</span>
      </div>
      <p className="font-display text-xl font-black">{EXTRACT_MESSAGES[Math.floor(elapsed / 3) % EXTRACT_MESSAGES.length]}</p>
      <p className="rounded-full border-[3px] border-ink bg-white px-4 py-1 text-sm font-bold tabular-nums">{elapsed}s · about 10 seconds</p>
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
