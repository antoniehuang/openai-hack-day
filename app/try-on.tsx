"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { connectLucy, DEFAULT_PROMPT, type LucyHandle, type LucyStatus } from "@/lib/lucy";
import { ChampionPicker } from "./champion-picker";
import { SkinLibrary } from "./skin-library";
import { hexButton, HexGlyph } from "./ui";

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

type Picker = "3d" | "2d";

const PICKERS: { id: Picker; label: string }[] = [
  { id: "3d", label: "3D Champions" },
  { id: "2d", label: "All skins" },
];

const EXTRACT_MESSAGES = [
  "Forging your skin…",
  "Channeling…",
  "Polishing the hextech…",
  "Enchanting the fabric…",
];

const panel =
  "hex-frame border border-gold-shadow bg-navy/90 shadow-[inset_0_0_0_1px_rgb(200_170_110/0.08),inset_0_0_40px_rgb(1_10_19/0.85),0_8px_30px_rgb(0_0_0/0.5)]";

const ghostButton =
  "border border-gold-dark bg-abyss/70 font-display font-bold uppercase tracking-[0.2em] text-gold transition hover:border-gold hover:text-cream hover:shadow-[0_0_18px_rgb(200_170_110/0.25)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

const railTitle = "flex items-center gap-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-gold";

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
  const [picker, setPicker] = useState<Picker>("3d");
  const [library, setLibrary] = useState<{ open: boolean; champion: string | null }>({ open: false, champion: null });
  const closeLibrary = useCallback(() => setLibrary((l) => ({ ...l, open: false })), []);
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

  function stopCamera() {
    stopLive();
    if (camera.kind === "on") for (const track of camera.stream.getTracks()) track.stop();
    setCamera({ kind: "off" });
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    setSnap(canvas.toDataURL("image/jpeg", 0.92));
  }

  const canGoLive = camera.kind === "on" && garment.kind === "ready" && session.kind !== "connecting";
  const isLive = session.kind === "live" || session.kind === "connecting";

  const steps = [
    { label: "Pick a skin", done: character !== null },
    { label: "Forge costume", done: garment.kind === "ready" },
    { label: "Light camera", done: camera.kind === "on" },
    { label: "Go live", done: session.kind === "live" },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip lg:h-dvh lg:overflow-hidden">
      {character && (
        <Image
          src={character.previewUrl}
          alt=""
          aria-hidden
          fill
          unoptimized
          className="-z-10 scale-110 object-cover opacity-20 blur-3xl"
        />
      )}

      <header className="relative z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-gold-shadow bg-abyss/80 px-4 py-2.5 backdrop-blur-sm lg:flex-nowrap lg:px-5">
        <div className="flex items-center gap-3">
          <HexGlyph className="h-8 w-8 shrink-0 text-gold" />
          <div className="leading-none">
            <h1 className="font-display text-lg font-black uppercase tracking-[0.12em] text-cream">Cosplay Mirror</h1>
            <p className="mt-1 text-[11px] uppercase tracking-[0.25em] text-parchment">Live League skin try-on</p>
          </div>
        </div>
        <PhaseTracker steps={steps} current={current} />
        <details className="relative ml-auto text-xs">
          <summary className="cursor-pointer list-none border border-gold-shadow px-3 py-1.5 uppercase tracking-[0.2em] text-parchment hover:border-gold-dark hover:text-cream">
            Log
          </summary>
          <pre className="absolute right-0 top-full z-50 mt-2 max-h-80 w-[min(32rem,90vw)] overflow-auto border border-gold-dark bg-abyss p-3 whitespace-pre-wrap text-parchment shadow-[0_10px_40px_rgb(0_0_0/0.8)]">
            {log.join("\n") || "No messages yet."}
          </pre>
        </details>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)_minmax(16rem,19rem)] lg:p-4">
        <aside aria-label="Champion select" className={`${panel} flex h-[70svh] min-h-0 flex-col lg:col-start-1 lg:row-start-1 lg:h-auto`}>
          <div role="tablist" aria-label="Pick by" className="grid shrink-0 grid-cols-2 border-b border-gold-shadow">
            {PICKERS.map((p) => {
              const active = p.id === picker;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPicker(p.id)}
                  className={`relative px-3 py-2.5 font-display text-xs font-bold uppercase tracking-[0.2em] transition after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${
                    active
                      ? "bg-abyss/60 text-cream after:bg-gold after:shadow-[0_0_10px_var(--color-gold)]"
                      : "text-parchment hover:text-gold"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {picker === "3d" ? (
            <ChampionPicker
              onPick={(file, champion) => {
                chooseCharacter(file);
                addLog(`champion pick ${champion}`);
              }}
            />
          ) : (
            <SkinLibrary
              open
              initialChampion={library.champion}
              onClose={closeLibrary}
              onPick={(file, skinName) => {
                chooseCharacter(file);
                addLog(`library pick ${skinName}`);
              }}
            />
          )}
        </aside>

        <aside aria-label="Loadout" className="flex min-h-0 flex-col gap-3 lg:col-start-3 lg:row-start-1 lg:overflow-y-auto">
          {snap && (
            <section className={`${panel} flex flex-col gap-3 p-3`}>
              <h2 className={railTitle}>
                Snapshot
                <span className="h-px flex-1 bg-gradient-to-r from-gold-dark to-transparent" />
              </h2>
              <Image src={snap} alt="Your cosplay snapshot" width={640} height={480} unoptimized className="w-full border border-gold" />
              <div className="flex gap-2">
                <a href={snap} download="cosplay-mirror.jpg" className={`${hexButton} flex-1 px-4 py-2 text-center text-xs`}>
                  Download
                </a>
                <button type="button" onClick={() => setSnap(null)} className={`${ghostButton} flex-1 px-4 py-2 text-xs`}>
                  Discard
                </button>
              </div>
            </section>
          )}

          <div className="flex flex-col gap-3 lg:flex-1">
            <section className={`${panel} flex flex-col gap-2 p-3`}>
              <h2 className={railTitle}>
                Skin art
                <span className="h-px flex-1 bg-gradient-to-r from-gold-dark to-transparent" />
              </h2>
              <DropZone
                upload={character}
                onFile={chooseCharacter}
                onReject={() => setGarment({ kind: "failed", message: "That file isn't an image. Try a JPG, PNG or WebP." })}
              />
            </section>

            <section className={`${panel} flex h-72 flex-col gap-2 p-3 lg:h-auto lg:min-h-64 lg:flex-1`}>
              <h2 className={railTitle}>
                Forged costume
                <span className="h-px flex-1 bg-gradient-to-r from-gold-dark to-transparent" />
              </h2>
              <CostumeCard garment={garment} onRetry={character ? () => void extract(character.file) : undefined} />
            </section>
          </div>
        </aside>

        <section aria-label="The mirror" className="flex min-h-0 flex-col gap-3 lg:col-start-2 lg:row-start-1">
          <div className={`${panel} relative aspect-[4/3] overflow-hidden bg-abyss lg:aspect-auto lg:flex-1`}>
            {session.kind === "live" && outputStream ? (
              <video ref={outputVideo} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            ) : cameraStream ? (
              <video ref={localVideo} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            ) : (
              <div className="relative isolate flex h-full flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgb(0_90_130/0.4),transparent_70%)] p-6 text-center">
                {character && (
                  <Image
                    src={character.previewUrl}
                    alt=""
                    aria-hidden
                    fill
                    unoptimized
                    className="-z-10 object-cover object-[50%_20%] opacity-20 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
                  />
                )}
                <HexGlyph className="h-14 w-14 animate-ember text-teal lg:h-20 lg:w-20" />
                <h2 className="font-display text-xl font-bold uppercase tracking-[0.2em] text-cream lg:text-2xl">The mirror sleeps</h2>
                <p className="max-w-sm text-sm text-parchment">
                  Light your camera to see yourself. Once your costume is forged, go live and the mirror dresses you in it
                  as you move.
                </p>
                {camera.kind === "denied" && (
                  <p role="alert" className="max-w-sm text-sm text-defeat">
                    Camera blocked: {camera.message}
                  </p>
                )}
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={camera.kind === "starting"}
                  className={`${hexButton} px-8 py-3 text-sm`}
                >
                  {camera.kind === "starting" ? "Waiting for camera…" : "Light the camera"}
                </button>
              </div>
            )}
            {session.kind === "live" && cameraStream && (
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                aria-label="Your camera"
                className="absolute bottom-3 right-3 w-1/4 max-w-56 -scale-x-100 border border-gold shadow-[0_0_16px_rgb(0_0_0/0.8)]"
              />
            )}
            {session.kind === "connecting" && <Overlay text={`Channeling… (${session.status})`} />}
            {cameraStream && (
              <button
                type="button"
                onClick={stopCamera}
                className="absolute right-3 top-3 z-10 border border-gold-dark bg-abyss/85 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-gold transition hover:border-gold hover:text-cream"
              >
                Camera off
              </button>
            )}
            {session.kind === "live" ? (
              <span className="absolute left-3 top-3 flex items-center gap-2 border border-teal bg-abyss/85 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.3em] text-cream">
                <span className="h-2 w-2 animate-pulse bg-teal shadow-[0_0_8px_var(--color-teal)]" /> Live
              </span>
            ) : (
              cameraStream && (
                <span className="absolute left-3 top-3 border border-gold-shadow bg-abyss/85 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.3em] text-parchment">
                  Preview · not live
                </span>
              )
            )}
          </div>

          {session.kind === "error" && <Bubble message={session.message} />}

          <div className={`${panel} flex flex-col gap-3 p-3 sm:flex-row sm:items-center`}>
            {isLive ? (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendPrompt();
                  }}
                  className="flex min-w-0 flex-1 gap-2"
                >
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="min-w-0 flex-1 border border-gold-dark bg-abyss px-3 py-2 text-sm text-cream outline-none placeholder:text-parchment focus:border-teal focus:shadow-[0_0_12px_rgb(10_200_185/0.3)]"
                    aria-label="Costume prompt"
                  />
                  <button type="submit" className={`${ghostButton} px-4 py-2 text-xs`}>
                    Recast
                  </button>
                </form>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={takeSnap}
                    disabled={session.kind !== "live"}
                    className={`${hexButton} flex-1 px-6 py-2.5 text-sm`}
                  >
                    Snapshot
                  </button>
                  <button type="button" onClick={stopLive} className={`${ghostButton} flex-1 px-6 py-2.5 text-sm`}>
                    Stop
                  </button>
                </div>
              </>
            ) : (
              <>
                <p aria-live="polite" className="flex-1 text-sm text-parchment">
                  <span className="mr-2 font-display text-xs font-bold uppercase tracking-[0.25em] text-gold">
                    {canGoLive ? "Ready" : "Next"}
                  </span>
                  {nextStep(garment, camera)}
                </p>
                <button
                  type="button"
                  onClick={goLive}
                  disabled={!canGoLive}
                  className={`${hexButton} px-12 py-3.5 text-base sm:min-w-64 lg:text-lg`}
                >
                  Go live
                </button>
              </>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}

function nextStep(garment: Garment, camera: Camera): string {
  if (garment.kind === "none") return "Pick a champion, then a skin. The forge turns it into a real costume.";
  if (garment.kind === "extracting") return "Forging your costume. About 10 seconds.";
  if (garment.kind === "failed") return "The forge went cold. Reforge, or pick another skin.";
  if (camera.kind === "starting") return "Allow camera access in your browser.";
  if (camera.kind === "denied") return "Camera blocked. Allow access, then light it again.";
  if (camera.kind === "off") return "Light your camera in the mirror.";
  return "Costume forged, camera lit. Step into the skin.";
}

function artTitle(file: File): string {
  const words = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : "Custom art";
}

function PhaseTracker({ steps, current }: { steps: { label: string; done: boolean }[]; current: number }) {
  return (
    <ol aria-label="Progress" className="order-last flex w-full items-center justify-between gap-1.5 lg:order-none lg:w-auto lg:flex-1 lg:justify-center lg:gap-2">
      {steps.map((step, i) => {
        const active = i === current;
        return (
          <li key={step.label} aria-current={active ? "step" : undefined} className="flex items-center gap-1.5 lg:gap-2">
            {i > 0 && <span className={`h-px w-4 lg:w-8 ${steps[i - 1].done ? "bg-gold" : "bg-gold-shadow"}`} />}
            <span
              className={`clip-hex flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold ${
                step.done ? "bg-gold text-abyss" : active ? "bg-teal text-abyss" : "bg-gold-shadow text-parchment"
              }`}
            >
              {step.done ? "✓" : i + 1}
            </span>
            <span
              className={`whitespace-nowrap font-display text-[11px] font-bold uppercase tracking-[0.15em] ${
                active ? "text-cream" : step.done ? "text-gold" : "text-parchment"
              } ${active ? "" : "hidden sm:inline"}`}
            >
              {step.label}
              {step.done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
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
    <section role="alert" className="flex flex-col gap-1 border border-defeat/60 bg-navy/95 px-4 py-3 shadow-[inset_0_0_30px_rgb(232_64_87/0.12)]">
      <p className="font-display text-xs font-bold uppercase tracking-[0.3em] text-defeat">Connection lost</p>
      <p className="break-words text-sm text-cream">{message}</p>
    </section>
  );
}

function CostumeCard({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  return (
    <div className="relative flex min-h-48 flex-1 flex-col overflow-hidden border border-gold-shadow bg-abyss">
      <GarmentBody garment={garment} onRetry={onRetry} />
    </div>
  );
}

function GarmentBody({ garment, onRetry }: { garment: Garment; onRetry?: () => void }) {
  switch (garment.kind) {
    case "none":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <HexGlyph className="h-10 w-10 text-gold-dark" />
          <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-cream">Awaiting a skin</p>
          <p className="text-xs text-parchment">The forge casts the skin as a real-world costume.</p>
        </div>
      );
    case "extracting":
      return <Stitching startedAt={garment.startedAt} />;
    case "ready":
      return (
        <div className="relative flex-1 bg-[radial-gradient(ellipse_at_center,#f0e6d2_0%,#d8ccb0_100%)]">
          <Image src={garment.url} alt="Forged costume" fill unoptimized className="object-contain p-2 mix-blend-multiply" />
        </div>
      );
    case "failed":
      return (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <HexGlyph className="h-10 w-10 text-defeat" />
          <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-defeat">The forge went cold</p>
          <p className="break-words text-xs text-parchment">{garment.message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={`${ghostButton} mt-1 px-5 py-2 text-xs`}>
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
    <div aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgb(3_151_171/0.25),transparent_70%)] p-4 text-center">
      <div className="flex gap-2 text-teal">
        <HexGlyph className="h-7 w-7 animate-ember" />
        <HexGlyph className="h-7 w-7 animate-ember [animation-delay:300ms]" />
        <HexGlyph className="h-7 w-7 animate-ember [animation-delay:600ms]" />
      </div>
      <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-cream">{EXTRACT_MESSAGES[Math.floor(elapsed / 3) % EXTRACT_MESSAGES.length]}</p>
      <div className="h-1 w-3/4 overflow-hidden bg-gold-shadow">
        <div className="h-full bg-gradient-to-r from-teal-deep to-teal transition-[width] duration-300" style={{ width: `${Math.min(95, elapsed * 10)}%` }} />
      </div>
      <p className="text-xs uppercase tracking-[0.2em] text-parchment tabular-nums">{elapsed}s · about 10 s</p>
    </div>
  );
}

function DropZone({
  upload,
  onFile,
  onReject,
}: {
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
      className={`group flex cursor-pointer items-center gap-3 border p-2 transition hover:border-gold has-[input:focus-visible]:border-teal has-[input:focus-visible]:shadow-[0_0_0_1px_var(--color-teal)] ${
        dragging ? "border-teal bg-teal/10 shadow-[0_0_24px_rgb(10_200_185/0.3)]" : "border-dashed border-gold-dark"
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
      {upload ? (
        <span className="relative block aspect-[308/560] w-16 shrink-0 overflow-hidden border border-gold-dark">
          <Image src={upload.previewUrl} alt="Chosen skin art" fill unoptimized className="object-cover" />
        </span>
      ) : (
        <span className="flex aspect-[308/560] w-16 shrink-0 items-center justify-center border border-gold-shadow bg-abyss font-display text-2xl text-gold-dark">
          ✦
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-display text-sm font-bold uppercase tracking-[0.12em] text-cream">
          {dragging ? "Release to summon" : upload ? artTitle(upload.file) : "No skin yet"}
        </span>
        <span className="text-xs text-parchment group-hover:text-cream">
          {upload ? "Click or drop to swap art" : "Or drop your own art here. Full-body, front-facing works best."}
        </span>
      </span>
    </label>
  );
}
