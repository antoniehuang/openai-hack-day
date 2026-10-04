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
  "Forging your skin…",
  "Channeling…",
  "Polishing the hextech…",
  "Enchanting the fabric…",
];

const CHARACTER_IDEAS = ["Ahri", "Jinx", "Lux", "Yasuo", "Kai'Sa", "Seraphine", "Teemo", "Akali"];

const panel =
  "border border-gold-dark bg-navy shadow-[inset_0_0_0_1px_rgb(200_170_110/0.12),inset_0_0_40px_rgb(1_10_19/0.9),0_0_30px_rgb(0_0_0/0.6)]";

const hexButton =
  "clip-angled font-display font-bold uppercase tracking-[0.2em] text-abyss bg-[linear-gradient(180deg,#f0e6d2_0%,#c8aa6e_30%,#c89b3c_60%,#785a28_100%)] bg-[length:100%_200%] bg-top shadow-[0_0_18px_rgb(200_155_60/0.35)] transition hover:bg-bottom hover:shadow-[0_0_28px_rgb(200_155_60/0.6)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[linear-gradient(180deg,#3b4353_0%,#1e2328_100%)] disabled:text-parchment/60 disabled:shadow-none";

const ghostButton =
  "clip-angled border border-gold-dark bg-navy font-display font-bold uppercase tracking-[0.2em] text-gold transition hover:border-gold hover:text-cream hover:shadow-[0_0_18px_rgb(200_170_110/0.25)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

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
        onMessage: (msg) => {
          const text = JSON.stringify(msg);
          if (!text.includes('"action":"timings"')) addLog(`← ${text.slice(0, 300)}`);
        },
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

      <header className="relative flex flex-col items-center gap-5 text-center">
        <span className="flex items-center gap-3 font-display text-xs font-bold uppercase tracking-[0.35em] text-gold sm:text-sm">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold" />
          Summoner&apos;s Fitting Room
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold" />
        </span>
        <h1 className="font-display text-5xl font-black uppercase tracking-[0.08em] text-cream [text-shadow:0_0_30px_rgb(200_170_110/0.45),0_2px_0_rgb(70_55_20)] sm:text-7xl">
          Cosplay Mirror
        </h1>
        <p className="max-w-xl text-base text-parchment sm:text-lg">
          Drop in a champion&apos;s splash art, light your camera, and watch the skin wrap around you
          live. Move, spin, strike a pose on the Rift.
        </p>
      </header>

      <section className="relative grid gap-6 md:grid-cols-[1fr_1fr_1.6fr]">
        <Step n={1} title="Choose your champion">
          <DropZone
            label="Champion"
            hint="Full-body, front-facing splash art works best"
            emoji="✦"
            upload={character}
            onFile={chooseCharacter}
            onReject={() => setGarment({ kind: "failed", message: "That file isn't an image. Try a JPG, PNG or WebP." })}
          />
        </Step>

        <Step n={2} title="The Forge">
          <CostumeCard garment={garment} onRetry={character ? () => void extract(character.file) : undefined} />
        </Step>

        <Step n={3} title="The Mirror">
          <div className={`${panel} relative aspect-[4/3] overflow-hidden bg-abyss`}>
            {session.kind === "live" && outputStream ? (
              <video ref={outputVideo} autoPlay playsInline muted className="h-full w-full object-cover" />
            ) : cameraStream ? (
              <video ref={localVideo} autoPlay playsInline muted className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgb(0_90_130/0.35),transparent_70%)] p-6 text-center">
                <HexGlyph className="h-16 w-16 animate-ember text-teal" />
                <p className="font-display text-lg font-bold uppercase tracking-[0.2em] text-cream">The mirror sleeps</p>
                {camera.kind === "denied" && (
                  <p className="text-sm text-defeat">Camera blocked: {camera.message}</p>
                )}
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={camera.kind === "starting"}
                  className={`${hexButton} px-7 py-2.5 text-sm`}
                >
                  {camera.kind === "starting" ? "Summoning camera…" : "Light the camera"}
                </button>
              </div>
            )}
            {session.kind === "live" && cameraStream && (
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                className="absolute bottom-3 right-3 w-1/4 border border-gold shadow-[0_0_16px_rgb(0_0_0/0.8)]"
              />
            )}
            {session.kind === "connecting" && <Overlay text={`Channeling… (${session.status})`} />}
            {session.kind === "live" && (
              <span className="absolute left-3 top-3 flex items-center gap-2 border border-gold bg-abyss/85 px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.3em] text-cream">
                <span className="h-2 w-2 animate-pulse bg-teal shadow-[0_0_8px_var(--color-teal)]" /> Live
              </span>
            )}
          </div>
        </Step>
      </section>

      <div className="relative flex flex-wrap items-center justify-center gap-4">
        {isLive ? (
          <>
            <button type="button" onClick={stopLive} className={`${ghostButton} px-8 py-3 text-base`}>
              Recall
            </button>
            <button
              type="button"
              onClick={takeSnap}
              disabled={session.kind !== "live"}
              className={`${hexButton} px-8 py-3 text-base`}
            >
              Capture
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={goLive}
            disabled={!canGoLive}
            className={`${hexButton} px-14 py-4 text-lg sm:text-xl`}
          >
            Go live
          </button>
        )}
      </div>
      {!isLive && !canGoLive && (
        <p className="relative -mt-6 text-center text-xs uppercase tracking-[0.2em] text-parchment">
          {garment.kind !== "ready" ? "Choose a champion and wait for the forge. " : ""}
          {camera.kind !== "on" ? "Light your camera." : ""}
        </p>
      )}

      {session.kind === "error" && <Bubble message={session.message} />}

      {isLive && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt();
          }}
          className={`${panel} relative mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 sm:flex-row`}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 border border-gold-dark bg-abyss px-4 py-2 text-cream outline-none placeholder:text-parchment/50 focus:border-teal focus:shadow-[0_0_12px_rgb(10_200_185/0.3)]"
            aria-label="Costume prompt"
          />
          <button type="submit" className={`${ghostButton} px-6 py-2 text-sm`}>
            Recast
          </button>
        </form>
      )}

      {snap && (
        <section className={`${panel} relative mx-auto flex w-full max-w-md flex-col gap-4 p-4 pb-6`}>
          <Image src={snap} alt="Your cosplay snapshot" width={640} height={480} unoptimized className="w-full border border-gold" />
          <div className="flex justify-center gap-3">
            <a href={snap} download="cosplay-mirror.jpg" className={`${hexButton} px-6 py-2 text-sm`}>
              Download
            </a>
            <button type="button" onClick={() => setSnap(null)} className={`${ghostButton} px-6 py-2 text-sm`}>
              Close
            </button>
          </div>
        </section>
      )}

      <section className="relative flex flex-col items-center gap-4">
        <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-gold">Champion ideas</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {CHARACTER_IDEAS.map((name, i) => (
            <li
              key={name}
              className={`clip-angled border px-4 py-1.5 text-xs uppercase tracking-[0.15em] ${
                i % 2 === 0 ? "border-gold-dark bg-navy text-cream" : "border-blue-deep bg-navy-deep text-teal"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      </section>

      <details className="relative mx-auto w-full max-w-3xl text-xs">
        <summary className="cursor-pointer text-center uppercase tracking-[0.2em] text-parchment/60">Debug log</summary>
        <pre className="mt-2 max-h-64 overflow-auto border border-gold-shadow bg-abyss/80 p-3 whitespace-pre-wrap text-parchment">
          {log.join("\n") || "No messages yet."}
        </pre>
      </details>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-3 whitespace-nowrap font-display text-sm font-bold uppercase tracking-[0.25em] text-cream">
        <span className="clip-hex flex h-8 w-8 items-center justify-center bg-gold text-xs text-abyss">{n}</span>
        {title}
        <span className="h-px flex-1 bg-gradient-to-r from-gold-dark to-transparent" />
      </h2>
      {children}
    </div>
  );
}

function Overlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-abyss/75 text-center backdrop-blur-[2px]">
      <HexGlyph className="h-14 w-14 animate-hex-spin text-teal" />
      <p className="font-display text-base font-bold uppercase tracking-[0.25em] text-cream">{text}</p>
    </div>
  );
}

function Bubble({ message }: { message: string }) {
  return (
    <section role="alert" className="relative mx-auto flex w-full max-w-xl flex-col gap-1 border border-defeat/60 bg-navy/90 px-5 py-4 shadow-[inset_0_0_30px_rgb(232_64_87/0.12)]">
      <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-defeat">Connection lost</p>
      <p className="break-words text-sm text-cream">{message}</p>
    </section>
  );
}

function CostumeCard({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  return (
    <div className={`${panel} relative flex aspect-[4/5] flex-col overflow-hidden`}>
      <GarmentBody garment={garment} onRetry={onRetry} />
    </div>
  );
}

function GarmentBody({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  switch (garment.kind) {
    case "none":
      return (
        <div className="m-4 flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-gold-dark/60 p-6 text-center">
          <HexGlyph className="h-14 w-14 text-gold-dark" />
          <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-cream">Awaiting a champion</p>
          <p className="text-sm text-parchment">The forge will cast a real-world skin from the art.</p>
        </div>
      );
    case "extracting":
      return <Stitching startedAt={garment.startedAt} />;
    case "ready":
      return (
        <>
          <Image src={garment.url} alt="Extracted costume" fill unoptimized className="object-contain p-2" />
          <span className="absolute left-4 top-4 border border-gold bg-abyss/85 px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.25em] text-gold">
            Skin forged
          </span>
        </>
      );
    case "failed":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <HexGlyph className="h-12 w-12 text-defeat" />
          <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-defeat">The forge went cold</p>
          <p className="break-words text-sm text-parchment">{garment.message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={`${ghostButton} px-5 py-2 text-xs`}>
              Reforge
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
    <div aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-5 bg-[radial-gradient(ellipse_at_center,rgb(3_151_171/0.25),transparent_70%)] p-6 text-center">
      <div className="flex gap-3 text-teal">
        <HexGlyph className="h-8 w-8 animate-ember" />
        <HexGlyph className="h-8 w-8 animate-ember [animation-delay:300ms]" />
        <HexGlyph className="h-8 w-8 animate-ember [animation-delay:600ms]" />
      </div>
      <p className="font-display text-base font-bold uppercase tracking-[0.2em] text-cream">{EXTRACT_MESSAGES[Math.floor(elapsed / 3) % EXTRACT_MESSAGES.length]}</p>
      <p className="border border-gold-dark px-4 py-1 text-xs uppercase tracking-[0.2em] text-parchment tabular-nums">{elapsed}s · about 10 seconds</p>
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
      className={`${panel} group relative flex aspect-[4/5] cursor-pointer flex-col overflow-hidden transition hover:border-gold hover:shadow-[0_0_24px_rgb(200_170_110/0.25)] ${
        dragging ? "border-teal shadow-[0_0_24px_rgb(10_200_185/0.4)]" : ""
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
      <span className="absolute left-4 top-4 z-10 border border-gold bg-abyss/85 px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.25em] text-gold">
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
          <span className="absolute bottom-4 right-4 z-10 border border-gold bg-abyss/85 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cream opacity-0 transition group-hover:opacity-100">
            Change art
          </span>
        </>
      ) : (
        <span className="m-4 mt-14 flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-gold-dark/60 p-6 text-center">
          <span className="animate-ember font-display text-5xl text-gold">{emoji}</span>
          <span className="font-display text-base font-bold uppercase tracking-[0.2em] text-cream">
            {dragging ? "Release to summon" : "Click or drop splash art"}
          </span>
          <span className="text-sm text-parchment">{hint}</span>
        </span>
      )}
    </label>
  );
}

function HexGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" fill="none" stroke="currentColor" className={className}>
      <path d="M50 4 90 27v46L50 96 10 73V27z" strokeWidth="3" />
      <path d="M50 22 74 36v28L50 78 26 64V36z" strokeWidth="2" opacity="0.6" />
      <circle cx="50" cy="50" r="6" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

function Decorations() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 select-none text-gold">
      <HexGlyph className="absolute left-[3%] top-[4%] h-16 w-16 animate-float" />
      <HexGlyph className="absolute right-[5%] top-[7%] h-10 w-10 animate-float text-teal [animation-delay:2s]" />
      <HexGlyph className="absolute left-[1%] top-[46%] h-8 w-8 animate-float [animation-delay:4s]" />
      <HexGlyph className="absolute right-[2%] top-[58%] h-20 w-20 animate-float [animation-delay:1s]" />
      <HexGlyph className="absolute bottom-[8%] left-[9%] h-12 w-12 animate-float text-teal [animation-delay:3s]" />
      <HexGlyph className="absolute bottom-[4%] right-[11%] h-9 w-9 animate-float [animation-delay:5s]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
    </div>
  );
}
