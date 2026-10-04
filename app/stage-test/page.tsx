"use client";

import { useRef, useState } from "react";
import manifest from "@/public/models/manifest.json";
import {
  ChampionStage,
  type ChampionModel,
  type ChampionStageHandle,
  type ChampionStageStatus,
} from "../champion-stage";

const champions = manifest as ChampionModel[];
const FEATURED = ["ahri", "teemo", "thresh", "kaisa", "annie", "yasuo"];

export default function StageTestPage() {
  const stageRef = useRef<ChampionStageHandle>(null);
  const [alias, setAlias] = useState("ahri");
  const [status, setStatus] = useState<string>("idle");
  const [capture, setCapture] = useState<{ url: string; name: string; size: number } | null>(null);
  const model = champions.find((c) => c.alias === alias) ?? champions[0];

  async function onCapture() {
    const file = await stageRef.current!.capture();
    const bitmap = await createImageBitmap(file);
    setCapture((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { url: URL.createObjectURL(file), name: `${file.name} ${bitmap.width}x${bitmap.height}`, size: file.size };
    });
  }

  return (
    <main className="min-h-screen bg-neutral-900 p-4 text-white">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FEATURED.map((a) => (
          <button
            key={a}
            onClick={() => setAlias(a)}
            className={`rounded px-3 py-1 ${a === alias ? "bg-amber-500 text-black" : "bg-neutral-700"}`}
          >
            {a}
          </button>
        ))}
        <select value={alias} onChange={(e) => setAlias(e.target.value)} className="rounded bg-neutral-700 px-2 py-1">
          {champions.map((c) => (
            <option key={c.alias} value={c.alias}>
              {c.champion}
            </option>
          ))}
        </select>
        <button onClick={onCapture} className="rounded bg-sky-600 px-3 py-1">
          Capture
        </button>
        <span data-testid="status">status: {status}</span>
      </div>
      <div className="flex gap-4">
        <ChampionStage
          ref={stageRef}
          model={model}
          className="h-[70vh] w-[40vw] rounded border border-neutral-700 bg-[radial-gradient(circle,#334_0%,#111_100%)]"
          onStatus={(s: ChampionStageStatus, detail?: string) => setStatus(detail ? `${s}: ${detail}` : s)}
        />
        {capture && (
          <figure className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={capture.url}
              alt="capture"
              className="h-[70vh] w-auto border border-dashed border-neutral-500 bg-[repeating-conic-gradient(#555_0_25%,#777_0_50%)] bg-[length:20px_20px]"
            />
            <figcaption data-testid="capture-info">
              {capture.name} ({Math.round(capture.size / 1024)} KB)
            </figcaption>
          </figure>
        )}
      </div>
    </main>
  );
}
