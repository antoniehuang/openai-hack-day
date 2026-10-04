import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CHAMPIONS = [
  "Ahri", "Akali", "Annie", "Ashe", "Aurora", "Caitlyn", "Darius", "Diana", "Draven", "Ekko",
  "Evelynn", "Ezreal", "Fiora", "Garen", "Gwen", "Irelia", "Janna", "Jhin", "Jinx", "Kai'Sa",
  "Katarina", "Kayle", "Kayn", "Leona", "Lee Sin", "LeBlanc", "Lillia", "Lux", "Master Yi", "Miss Fortune",
  "Morgana", "Nami", "Neeko", "Nidalee", "Qiyana", "Riven", "Samira", "Senna", "Seraphine", "Sett",
  "Sona", "Soraka", "Syndra", "Teemo", "Thresh", "Vayne", "Vi", "Viego", "Yasuo", "Zoe",
];
const MAX_MODELS = 50;
const UA = "cosplay-tryon-hackday/1.0";
const OUT = "public/models";
const SUMMARY = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json";
const modelUrl = (alias, skinId) => `https://cdn.modelviewer.lol/lol/models/${alias}/${skinId}/model-lite-compressed.wasm?c=1`;

if (CHAMPIONS.length > MAX_MODELS || new Set(CHAMPIONS).size !== CHAMPIONS.length) {
  throw new Error(`Expected at most ${MAX_MODELS} unique champions, got ${CHAMPIONS.length}.`);
}

const summary = await (await fetch(SUMMARY, { headers: { "User-Agent": UA } })).json();
const byName = new Map(summary.filter((c) => c.id > 0 && c.id < 1000).map((c) => [c.name, c]));
const skins = JSON.parse(await readFile("public/skins/manifest.json", "utf8"));

await mkdir(OUT, { recursive: true });
const manifest = [];
for (const name of CHAMPIONS) {
  const champ = byName.get(name);
  if (!champ) throw new Error(`Unknown champion ${name}`);
  const alias = champ.alias.toLowerCase();
  const skinId = champ.id * 1000;
  const portrait = skins.find((s) => s.champion === name && s.skin.startsWith("Original"))?.file ?? null;
  const file = join(OUT, `${alias}.glb`);
  const exists = await stat(file).then((s) => s.size > 0, () => false);
  if (!exists) {
    const res = await fetch(modelUrl(alias, skinId), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
    await rename(`${file}.part`, file);
    await new Promise((r) => setTimeout(r, 200));
  }
  manifest.push({ champion: name, alias, skinId, model: `/models/${alias}.glb`, portrait });
  console.log(`${exists ? "have" : "got "} ${name}`);
}
await writeFile(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${manifest.length} models`);
