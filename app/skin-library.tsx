"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type Skin = { champion: string; skin: string; file: string };

type Champion = { name: string; portrait: string; skins: Skin[] };

type Library =
  | { kind: "loading" }
  | { kind: "ready"; champions: Champion[] }
  | { kind: "error"; message: string };

type View = { kind: "champions" } | { kind: "skins"; champion: string };

const MAX_SEARCH_RESULTS = 120;

let manifestPromise: Promise<Champion[]> | null = null;

function isSkin(value: unknown): value is Skin {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.champion === "string" && typeof v.skin === "string" && typeof v.file === "string";
}

function loadChampions(): Promise<Champion[]> {
  manifestPromise ??= fetch("/skins/manifest.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Couldn't load the skin library (HTTP ${res.status}).`);
      return res.json() as Promise<unknown>;
    })
    .then((data) => {
      if (!Array.isArray(data)) throw new Error("The skin library is malformed.");
      const byChampion = new Map<string, Skin[]>();
      for (const entry of data.filter(isSkin)) {
        const skins = byChampion.get(entry.champion) ?? [];
        skins.push(entry);
        byChampion.set(entry.champion, skins);
      }
      return [...byChampion].map(([name, skins]) => ({
        name,
        skins,
        portrait: (skins.find((s) => s.skin.startsWith("Original")) ?? skins[0]).file,
      }));
    })
    .catch((err: unknown) => {
      manifestPromise = null;
      throw err;
    });
  return manifestPromise;
}

async function skinToFile(skin: Skin): Promise<File> {
  const res = await fetch(skin.file);
  if (!res.ok) throw new Error(`Couldn't load ${skin.skin}.`);
  const blob = await res.blob();
  return new File([blob], skin.file.split("/").pop() ?? "skin.jpg", { type: blob.type || "image/jpeg" });
}

export function SkinLibrary({
  open,
  initialChampion,
  onClose,
  onPick,
}: {
  open: boolean;
  initialChampion: string | null;
  onClose: () => void;
  onPick: (file: File, skinName: string) => void;
}) {
  const [library, setLibrary] = useState<Library>({ kind: "loading" });
  const [view, setView] = useState<View>({ kind: "champions" });
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadChampions().then(
      (champions) => live && setLibrary({ kind: "ready", champions }),
      (err: unknown) =>
        live && setLibrary({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [openedFor, setOpenedFor] = useState<string | null | undefined>(undefined);
  if (open && openedFor !== initialChampion) {
    setOpenedFor(initialChampion);
    setView(initialChampion ? { kind: "skins", champion: initialChampion } : { kind: "champions" });
    setQuery("");
    setPickError(null);
  }
  if (!open && openedFor !== undefined) setOpenedFor(undefined);

  const champions = useMemo(() => (library.kind === "ready" ? library.champions : []), [library]);
  const needle = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!needle) return null;
    const matchingChampions = champions.filter((c) => c.name.toLowerCase().includes(needle));
    const matchingSkins = champions
      .flatMap((c) => c.skins)
      .filter((s) => s.skin.toLowerCase().includes(needle))
      .slice(0, MAX_SEARCH_RESULTS);
    return { matchingChampions, matchingSkins };
  }, [champions, needle]);

  if (!open) return null;

  async function pick(skin: Skin) {
    setPicking(skin.file);
    setPickError(null);
    try {
      onPick(await skinToFile(skin), skin.skin);
      onClose();
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(null);
    }
  }

  const current = view.kind === "skins" ? champions.find((c) => c.name === view.champion) : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Skin library"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-abyss/85 p-3 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-6xl flex-col border border-gold-dark bg-navy shadow-[inset_0_0_0_1px_rgb(200_170_110/0.12),0_0_60px_rgb(0_0_0/0.8)]"
      >
        <header className="flex flex-col gap-3 border-b border-gold-shadow p-4 sm:flex-row sm:items-center sm:p-6">
          <div className="flex flex-1 items-center gap-3">
            {view.kind === "skins" && !needle && (
              <button
                type="button"
                onClick={() => setView({ kind: "champions" })}
                className="clip-angled border border-gold-dark px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.2em] text-gold hover:border-gold hover:text-cream"
              >
                ← All champions
              </button>
            )}
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.2em] text-cream">
              {needle ? "Search" : current ? current.name : "Skin library"}
            </h2>
            {library.kind === "ready" && !needle && (
              <span className="text-xs uppercase tracking-[0.2em] text-parchment">
                {current ? `${current.skins.length} skins` : `${champions.length} champions`}
              </span>
            )}
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search champion or skin… e.g. Star Guardian"
            aria-label="Search the skin library"
            className="w-full border border-gold-dark bg-abyss px-4 py-2 text-cream outline-none placeholder:text-parchment/60 focus:border-gold sm:w-80"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="absolute right-3 top-3 text-2xl text-gold hover:text-cream sm:static"
          >
            ✕
          </button>
        </header>

        {pickError && <p className="border-b border-gold-shadow px-6 py-2 text-sm text-defeat">{pickError}</p>}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {library.kind === "loading" && <p className="text-center text-parchment">Opening the vault…</p>}
          {library.kind === "error" && <p className="text-center text-defeat">{library.message}</p>}
          {library.kind === "ready" &&
            (searchResults ? (
              <div className="flex flex-col gap-6">
                {searchResults.matchingChampions.length > 0 && (
                  <ChampionGrid
                    champions={searchResults.matchingChampions}
                    onOpen={(name) => {
                      setQuery("");
                      setView({ kind: "skins", champion: name });
                    }}
                  />
                )}
                {searchResults.matchingSkins.length > 0 && (
                  <SkinGrid skins={searchResults.matchingSkins} picking={picking} onPick={pick} showChampion />
                )}
                {searchResults.matchingChampions.length === 0 && searchResults.matchingSkins.length === 0 && (
                  <p className="text-center text-parchment">No champion or skin matches “{query}”.</p>
                )}
              </div>
            ) : current ? (
              <SkinGrid skins={current.skins} picking={picking} onPick={pick} />
            ) : (
              <ChampionGrid champions={champions} onOpen={(name) => setView({ kind: "skins", champion: name })} />
            ))}
        </div>

        <footer className="border-t border-gold-shadow px-6 py-2 text-[10px] uppercase tracking-[0.2em] text-parchment/60">
          Skin art © Riot Games, via the League of Legends Wiki. Demo use only.
        </footer>
      </div>
    </div>
  );
}

function ChampionGrid({ champions, onOpen }: { champions: Champion[]; onOpen: (name: string) => void }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
      {champions.map((c) => (
        <li key={c.name}>
          <button
            type="button"
            onClick={() => onOpen(c.name)}
            className="group flex w-full flex-col border border-gold-shadow bg-abyss text-left transition hover:border-gold hover:shadow-[0_0_18px_rgb(200_170_110/0.3)]"
          >
            <span className="relative block aspect-[308/360] w-full overflow-hidden">
              <Image
                src={c.portrait}
                alt={c.name}
                fill
                unoptimized
                sizes="140px"
                className="object-cover object-top transition group-hover:scale-105"
              />
            </span>
            <span className="truncate px-2 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-cream">
              {c.name}
            </span>
            <span className="px-2 pb-1.5 text-[10px] text-parchment">{c.skins.length} skins</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SkinGrid({
  skins,
  picking,
  onPick,
  showChampion = false,
}: {
  skins: Skin[];
  picking: string | null;
  onPick: (skin: Skin) => void;
  showChampion?: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
      {skins.map((s) => (
        <li key={s.file}>
          <button
            type="button"
            onClick={() => onPick(s)}
            disabled={picking !== null}
            className="group flex w-full flex-col border border-gold-shadow bg-abyss text-left transition hover:border-gold hover:shadow-[0_0_18px_rgb(200_170_110/0.35)] disabled:cursor-wait"
          >
            <span className="relative block aspect-[308/560] w-full overflow-hidden">
              <Image src={s.file} alt={s.skin} fill unoptimized sizes="200px" className="object-cover transition group-hover:scale-105" />
              {picking === s.file && (
                <span className="absolute inset-0 flex items-center justify-center bg-abyss/70 font-display text-xs uppercase tracking-[0.2em] text-gold">
                  Summoning…
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 translate-y-full bg-[linear-gradient(180deg,transparent,rgb(1_10_19/0.95))] px-2 pb-2 pt-6 text-center font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gold transition group-hover:translate-y-0">
                Wear this skin
              </span>
            </span>
            <span className="px-2 py-1.5 text-xs leading-tight text-cream">{s.skin}</span>
            {showChampion && <span className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.15em] text-parchment">{s.champion}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
