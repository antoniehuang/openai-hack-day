// Scrapes League of Legends skin art from the community wiki into public/skins/.
// Skin list: Module:SkinData/data (the Lua table behind List_of_skins_by_champion).
// Image per skin: loading-screen portrait, else centered splash, else splash, scaled to <=768px.
// Safe to re-run: existing files are kept and the manifest is rebuilt from what is on disk.
//
//   node scripts/scrape-skins.mjs

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIKI = "https://wiki.leagueoflegends.com/en-us";
const API = `${WIKI}/api.php`;
const USER_AGENT = "cosplay-tryon-hackday/1.0 (fan demo; contact via repo owner)";
const MAX_SIDE = 768;
const CONCURRENCY = 4;
const DELAY_MS = 150;
const TITLES_PER_QUERY = 50;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "skins");

// Fallback order. The size param keeps the long side at MAX_SIDE for each art's orientation.
const ART_KINDS = [
  { suffix: "Loading", ext: "jpg", sizeParam: "iiurlheight" },
  { suffix: "Centered", ext: "jpg", sizeParam: "iiurlwidth" },
  { suffix: "Skin", ext: "jpg", sizeParam: "iiurlwidth" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...init.headers },
    });
    await sleep(DELAY_MS);
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
  }
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Minimal parser for the Lua table literal in Module:SkinData/data.
function parseLuaTable(src) {
  let i = src.indexOf("return");
  if (i < 0) throw new Error("SkinData: no `return` found");
  i += "return".length;

  const skipWs = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("--", i)) {
        while (i < src.length && src[i] !== "\n") i++;
      } else return;
    }
  };
  const expect = (ch) => {
    skipWs();
    if (src[i] !== ch) throw new Error(`SkinData: expected '${ch}' at ${i}, got '${src[i]}'`);
    i++;
  };
  const parseString = () => {
    const quote = src[i++];
    let out = "";
    while (src[i] !== quote) {
      if (src[i] === "\\") {
        const c = src[++i];
        out += { n: "\n", t: "\t", r: "\r" }[c] ?? c;
      } else out += src[i];
      i++;
    }
    i++;
    return out;
  };
  const parseValue = () => {
    skipWs();
    const c = src[i];
    if (c === "{") return parseTable();
    if (c === '"' || c === "'") return parseString();
    const m = /^(true|false|nil|-?\d+(?:\.\d+)?)/.exec(src.slice(i, i + 32));
    if (!m) throw new Error(`SkinData: unexpected token at ${i}: ${src.slice(i, i + 20)}`);
    i += m[0].length;
    if (m[0] === "true") return true;
    if (m[0] === "false") return false;
    if (m[0] === "nil") return null;
    return Number(m[0]);
  };
  const parseTable = () => {
    expect("{");
    const obj = {};
    const arr = [];
    for (;;) {
      skipWs();
      if (src[i] === "}") {
        i++;
        break;
      }
      if (src[i] === "[") {
        i++;
        const key = parseValue();
        expect("]");
        expect("=");
        obj[key] = parseValue();
      } else {
        const ident = /^[A-Za-z_]\w*(?=\s*=)/.exec(src.slice(i, i + 64));
        if (ident) {
          i += ident[0].length;
          expect("=");
          obj[ident[0]] = parseValue();
        } else arr.push(parseValue());
      }
      skipWs();
      if (src[i] === "," || src[i] === ";") i++;
    }
    return arr.length && !Object.keys(obj).length ? arr : obj;
  };
  return parseValue();
}

// Mirrors Module:Filename: "<Champion> <SkinNoSpaces><Suffix>.<ext>", ':' -> '-', '/' dropped.
function wikiFileTitle(champion, skinKey, kind) {
  const name = `${champion} ${skinKey.replaceAll(" ", "")}${kind.suffix}.${kind.ext}`;
  return `File:${name.replaceAll(":", "-").replaceAll("/", "")}`;
}

function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’.]/g, "")
    .replace(/&/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSkinList(data) {
  const skins = [];
  for (const [champion, champ] of Object.entries(data)) {
    const championSlug = slugify(champion);
    const used = new Set();
    const entries = Object.entries(champ.skins ?? {}).sort(([, a], [, b]) => a.id - b.id);
    for (const [skinKey, info] of entries) {
      const display = info.formatname ?? `${skinKey} ${champion}`;
      let skinSlug = slugify(display) || `skin-${info.id}`;
      if (used.has(skinSlug)) skinSlug = `${skinSlug}-${info.id}`;
      used.add(skinSlug);
      skins.push({ champion, championSlug, skinKey, display, skinSlug });
    }
  }
  return skins;
}

async function queryImageInfo(titles, sizeParam) {
  const body = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    [sizeParam]: String(MAX_SIDE),
    titles: titles.join("|"),
  });
  const res = await politeFetch(API, { method: "POST", body });
  const json = await res.json();
  const normalized = new Map((json.query.normalized ?? []).map((n) => [n.to, n.from]));
  const found = new Map();
  for (const page of json.query.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (page.missing || !info) continue;
    const requested = normalized.get(page.title) ?? page.title;
    found.set(requested, {
      imageUrl: info.thumburl ?? info.url,
      sourceUrl: info.descriptionurl,
      width: info.thumbwidth ?? info.width,
      height: info.thumbheight ?? info.height,
    });
  }
  return found;
}

async function resolveImages(skins) {
  let pending = skins;
  for (const kind of ART_KINDS) {
    if (!pending.length) break;
    const batches = [];
    for (let i = 0; i < pending.length; i += TITLES_PER_QUERY) {
      batches.push(pending.slice(i, i + TITLES_PER_QUERY));
    }
    await mapPool(batches, CONCURRENCY, async (batch) => {
      const titles = batch.map((s) => wikiFileTitle(s.champion, s.skinKey, kind));
      const found = await queryImageInfo(titles, kind.sizeParam);
      batch.forEach((s, j) => {
        const hit = found.get(titles[j]);
        if (hit) s.image = { kind: kind.suffix, ...hit };
      });
    });
    pending = pending.filter((s) => !s.image);
    console.log(`resolved via ${kind.suffix}: ${skins.length - pending.length}/${skins.length} total`);
  }
  return pending;
}

async function exists(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function download(skin) {
  const ext = path.extname(new URL(skin.image.imageUrl).pathname).toLowerCase() || ".jpg";
  const relative = `${skin.championSlug}/${skin.skinSlug}${ext}`;
  const target = path.join(OUT_DIR, relative);
  skin.file = `/skins/${relative}`;
  if (await exists(target)) return "skipped";
  await mkdir(path.dirname(target), { recursive: true });
  const res = await politeFetch(skin.image.imageUrl);
  const bytes = Buffer.from(await res.arrayBuffer());
  const tmp = `${target}.part`;
  await writeFile(tmp, bytes);
  await rename(tmp, target);
  return "downloaded";
}

async function main() {
  const started = Date.now();

  const raw = await (await politeFetch(`${WIKI}/Module:SkinData/data?action=raw`)).text();
  const data = parseLuaTable(raw);
  const champions = Object.keys(data);
  const skins = buildSkinList(data);
  console.log(`${champions.length} champions, ${skins.length} skins in SkinData`);

  const unresolved = await resolveImages(skins);
  const resolved = skins.filter((s) => s.image);

  const failures = unresolved.map((s) => ({ skin: s.display, reason: "no Loading/Centered/Skin file on wiki" }));
  const counts = { downloaded: 0, skipped: 0 };
  await mapPool(resolved, CONCURRENCY, async (skin, i) => {
    try {
      counts[await download(skin)]++;
    } catch (err) {
      skin.file = null;
      failures.push({ skin: skin.display, reason: String(err.message ?? err) });
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${resolved.length} images processed`);
  });

  const manifest = resolved
    .filter((s) => s.file)
    .map((s) => ({ champion: s.champion, skin: s.display, file: s.file, sourceUrl: s.image.sourceUrl }))
    .sort((a, b) => a.champion.localeCompare(b.champion) || a.skin.localeCompare(b.skin));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const byKind = Object.groupBy(resolved, (s) => s.image.kind);
  console.log(
    JSON.stringify(
      {
        champions: champions.length,
        skins: skins.length,
        artKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])),
        downloaded: counts.downloaded,
        alreadyPresent: counts.skipped,
        inManifest: manifest.length,
        failures,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
