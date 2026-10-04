"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { hexButton, HexGlyph } from "./ui";
import type { ChampionModel, ChampionStageHandle, ChampionStageStatus } from "./champion-stage";

const ChampionStage = dynamic(() => import("./champion-stage").then((m) => m.ChampionStage), { ssr: false });

type Roster =
  | { kind: "loading" }
  | { kind: "ready"; champions: ChampionModel[] }
  | { kind: "error"; message: string };

type Stage = { kind: "loading" } | { kind: "ready" } | { kind: "error"; detail: string };

type Wear = { kind: "idle" } | { kind: "capturing" } | { kind: "failed"; message: string };

let rosterPromise: Promise<ChampionModel[]> | null = null;

function isChampionModel(value: unknown): value is ChampionModel {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.champion === "string" &&
    typeof v.alias === "string" &&
    typeof v.skinId === "number" &&
    typeof v.model === "string" &&
    (typeof v.portrait === "string" || v.portrait === null)
  );
}

function loadRoster(): Promise<ChampionModel[]> {
  rosterPromise ??= fetch("/models/manifest.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Couldn't load the champion roster (HTTP ${res.status}).`);
      return res.json() as Promise<unknown>;
    })
    .then((data) => {
      if (!Array.isArray(data)) throw new Error("The champion roster is malformed.");
      return data.filter(isChampionModel);
    })
    .catch((err: unknown) => {
      rosterPromise = null;
      throw err;
    });
  return rosterPromise;
}

export function ChampionPicker({ onPick }: { onPick: (file: File, championName: string) => void }) {
  const [roster, setRoster] = useState<Roster>({ kind: "loading" });
  const [selected, setSelected] = useState<ChampionModel | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [wear, setWear] = useState<Wear>({ kind: "idle" });
  const stageRef = useRef<ChampionStageHandle | null>(null);

  useEffect(() => {
    let live = true;
    loadRoster().then(
      (champions) => {
        if (!live) return;
        setRoster({ kind: "ready", champions });
        setSelected((s) => s ?? champions[0] ?? null);
      },
      (err: unknown) => live && setRoster({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, []);

  function select(champion: ChampionModel) {
    if (champion.alias === selected?.alias) return;
    setSelected(champion);
    setStage({ kind: "loading" });
    setWear({ kind: "idle" });
  }

  function onStatus(status: ChampionStageStatus, detail?: string) {
    setStage(status === "error" ? { kind: "error", detail: detail ?? "The model failed to load." } : { kind: status });
  }

  async function wearChampion() {
    if (!selected || !stageRef.current) return;
    setWear({ kind: "capturing" });
    try {
      onPick(await stageRef.current.capture(), selected.champion);
      setWear({ kind: "idle" });
    } catch (err) {
      setWear({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const canWear = selected !== null && stage.kind === "ready" && wear.kind !== "capturing";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-56 shrink-0 basis-1/2 flex-col overflow-hidden border-b border-gold-shadow bg-[radial-gradient(ellipse_at_50%_70%,rgb(0_90_130/0.45),transparent_70%)]">
        {selected ? (
          <>
            <ChampionStage key={selected.alias} ref={stageRef} model={selected} onStatus={onStatus} className="absolute inset-0" />
            <span className="pointer-events-none absolute left-3 top-3 border border-gold-shadow bg-abyss/85 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.3em] text-cream">
              {selected.champion}
            </span>
            {stage.kind === "ready" && (
              <span className="pointer-events-none absolute right-3 top-3 text-[10px] uppercase tracking-[0.25em] text-parchment">
                Drag to rotate
              </span>
            )}
            {stage.kind === "loading" && (
              <div aria-live="polite" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-abyss/60 text-center">
                <HexGlyph className="h-12 w-12 animate-hex-spin text-teal" />
                <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-cream">Summoning {selected.champion}…</p>
              </div>
            )}
            {stage.kind === "error" && (
              <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-abyss/80 p-4 text-center">
                <HexGlyph className="h-10 w-10 text-defeat" />
                <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-defeat">The rift is unstable</p>
                <p className="break-words text-xs text-parchment">{stage.detail}</p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 bg-[linear-gradient(180deg,transparent,rgb(1_10_19/0.95))] px-3 pb-3 pt-8">
              {wear.kind === "failed" && (
                <p role="alert" className="text-center text-xs text-defeat">
                  {wear.message}
                </p>
              )}
              <button type="button" onClick={wearChampion} disabled={!canWear} className={`${hexButton} w-full max-w-72 px-6 py-2.5 text-xs`}>
                {wear.kind === "capturing" ? "Summoning…" : "Wear this champion"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
            <HexGlyph className={`h-12 w-12 ${roster.kind === "error" ? "text-defeat" : "animate-ember text-teal"}`} />
            <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-cream">
              {roster.kind === "error" ? "The rift is unstable" : "Opening the rift…"}
            </p>
            {roster.kind === "error" && (
              <p role="alert" className="break-words text-xs text-parchment">
                {roster.message}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-8 items-center gap-2 border-b border-gold-shadow px-3 py-2">
        <h2 className="truncate font-display text-sm font-bold uppercase tracking-[0.2em] text-cream">Champions</h2>
        {roster.kind === "ready" && (
          <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.2em] text-parchment">{roster.champions.length}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:var(--color-gold-dark)_transparent] [scrollbar-width:thin]">
        {roster.kind === "loading" && <p className="py-8 text-center text-sm text-parchment">Opening the vault…</p>}
        {roster.kind === "error" && (
          <p role="alert" className="py-8 text-center text-sm text-defeat">
            {roster.message}
          </p>
        )}
        {roster.kind === "ready" && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
            {roster.champions.map((c) => {
              const active = c.alias === selected?.alias;
              return (
                <li key={c.alias}>
                  <button
                    type="button"
                    onClick={() => select(c)}
                    aria-pressed={active}
                    title={c.champion}
                    className="group flex w-full flex-col items-center gap-1 text-center"
                  >
                    <span
                      className={`relative block aspect-square w-full overflow-hidden border transition group-hover:shadow-[0_0_14px_rgb(200_170_110/0.45)] group-focus-visible:border-teal group-focus-visible:shadow-[0_0_0_1px_var(--color-teal)] ${
                        active ? "border-gold shadow-[0_0_14px_rgb(200_170_110/0.6)]" : "border-gold-shadow group-hover:border-gold"
                      }`}
                    >
                      {c.portrait ? (
                        <Image src={c.portrait} alt="" fill unoptimized sizes="96px" className="object-cover object-[50%_15%] transition group-hover:scale-110" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center font-display text-2xl text-gold-dark">✦</span>
                      )}
                    </span>
                    <span
                      className={`w-full truncate font-display text-[11px] font-bold uppercase tracking-[0.08em] group-hover:text-cream ${
                        active ? "text-gold" : "text-parchment"
                      }`}
                    >
                      {c.champion}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-gold-shadow px-3 py-2 text-[11px] text-parchment">
        Champion models and art © Riot Games. Demo use only.
      </footer>
    </div>
  );
}
