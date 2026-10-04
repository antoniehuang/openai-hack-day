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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-2.5 border-b border-gold-shadow p-3">
        <div className="flex min-h-8 items-center gap-2">
          {view.kind === "skins" && !needle && (
            <button
              type="button"
              onClick={() => setView({ kind: "champions" })}
              aria-label="Back to all champions"
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-gold-dark text-gold transition hover:border-gold hover:text-cream"
            >
              ←
            </button>
          )}
          <h2 className="truncate font-display text-sm font-bold uppercase tracking-[0.2em] text-cream">
            {needle ? "Search results" : current ? current.name : "Champions"}
          </h2>
          {library.kind === "ready" && !needle && (
            <span className="ml-auto shrink-0 text-[11px] uppercase tracking-[0.2em] text-parchment">
              {current ? `${current.skins.length} skins` : champions.length}
            </span>
          )}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search champion or skin, e.g. Star Guardian"
          aria-label="Search champions and skins"
          className="w-full border border-gold-dark bg-abyss px-3 py-2 text-sm text-cream outline-none placeholder:text-parchment focus:border-teal focus:shadow-[0_0_12px_rgb(10_200_185/0.3)]"
        />
      </header>

      {pickError && (
        <p role="alert" className="border-b border-gold-shadow px-3 py-2 text-sm text-defeat">
          {pickError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:var(--color-gold-dark)_transparent] [scrollbar-width:thin]">
        {library.kind === "loading" && <p className="py-8 text-center text-sm text-parchment">Opening the vault…</p>}
        {library.kind === "error" && (
          <p role="alert" className="py-8 text-center text-sm text-defeat">
            {library.message}
          </p>
        )}
        {library.kind === "ready" &&
          (searchResults ? (
            <div className="flex flex-col gap-4">
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
                <p className="py-8 text-center text-sm text-parchment">No champion or skin matches “{query}”.</p>
              )}
            </div>
          ) : current ? (
            <SkinGrid skins={current.skins} picking={picking} onPick={pick} />
          ) : (
            <ChampionGrid champions={champions} onOpen={(name) => setView({ kind: "skins", champion: name })} />
          ))}
      </div>

      <footer className="border-t border-gold-shadow px-3 py-2 text-[11px] text-parchment">
        Skin art © Riot Games, via the League of Legends Wiki. Demo use only.
      </footer>
    </div>
  );
}

function ChampionGrid({ champions, onOpen }: { champions: Champion[]; onOpen: (name: string) => void }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
      {champions.map((c) => (
        <li key={c.name}>
          <button
            type="button"
            onClick={() => onOpen(c.name)}
            title={`${c.name}, ${c.skins.length} skins`}
            className="group flex w-full flex-col items-center gap-1 text-center"
          >
            <span className="relative block aspect-square w-full overflow-hidden border border-gold-shadow transition group-hover:border-gold group-hover:shadow-[0_0_14px_rgb(200_170_110/0.45)] group-focus-visible:border-teal group-focus-visible:shadow-[0_0_0_1px_var(--color-teal)]">
              <Image
                src={c.portrait}
                alt=""
                fill
                unoptimized
                sizes="96px"
                className="object-cover object-[50%_15%] transition group-hover:scale-110"
              />
            </span>
            <span className="w-full truncate font-display text-[11px] font-bold uppercase tracking-[0.08em] text-parchment group-hover:text-cream">
              {c.name}
            </span>
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
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-2.5">
      {skins.map((s) => (
        <li key={s.file}>
          <button
            type="button"
            onClick={() => onPick(s)}
            disabled={picking !== null}
            className="group flex w-full flex-col text-left disabled:cursor-wait"
          >
            <span className="relative block aspect-[308/560] w-full overflow-hidden border border-gold-shadow transition group-hover:border-gold group-hover:shadow-[0_0_16px_rgb(200_170_110/0.4)] group-focus-visible:border-teal group-focus-visible:shadow-[0_0_0_1px_var(--color-teal)]">
              <Image src={s.file} alt="" fill unoptimized sizes="160px" className="object-cover transition group-hover:scale-105" />
              {picking === s.file && (
                <span className="absolute inset-0 flex items-center justify-center bg-abyss/75 font-display text-xs uppercase tracking-[0.2em] text-gold">
                  Summoning…
                </span>
              )}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 translate-y-full bg-[linear-gradient(180deg,transparent,rgb(1_10_19/0.95))] px-2 pb-2 pt-6 text-center font-display text-[11px] font-bold uppercase tracking-[0.15em] text-gold transition group-hover:translate-y-0 group-focus-visible:translate-y-0"
              >
                Wear this
              </span>
            </span>
            <span className="pt-1.5 text-xs leading-tight text-cream">{s.skin}</span>
            {showChampion && <span className="text-[11px] uppercase tracking-[0.12em] text-parchment">{s.champion}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
