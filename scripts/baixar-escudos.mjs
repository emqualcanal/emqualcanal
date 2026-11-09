// Baixa os escudos achados (Wikidata/TheSportsDB), converte para webp pequeno e guarda em docs/escudos/.
// Falhas nunca derrubam a atualização: o time continua apontando para o endereço original.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";

const OUT = process.env.OUT_DIR || "docs/data";
const DIR = process.env.ESCUDOS_DIR || "docs/escudos";
const MAX = Number(process.env.ESCUDOS_MAX || 40);
const UA = { "user-agent": "EQC-lives/1.0 (site de agenda de futebol; escudos via Wikidata)" };
const exists = (f) => access(f).then(() => true, () => false);
const slug = (k) => k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "time";

let sharp;
try { sharp = (await import("sharp")).default; } catch { console.log("escudos: sharp indisponível, mantendo endereços originais."); process.exit(0); }

const file = `${OUT}/escudos.json`;
let data;
try { data = JSON.parse(await readFile(file, "utf8")); } catch { process.exit(0); }
await mkdir(DIR, { recursive: true });

let baixados = 0, falhas = 0;
for (const [k, e] of Object.entries(data.escudos || {})) {
  if (e.manual) continue;
  const local = `escudos/${slug(k)}.webp`;
  const disk = `${DIR}/${slug(k)}.webp`;
  const remote = e.remote || (/^https?:/.test(e.url || "") ? e.url : null);
  if (!remote) continue;
  e.remote = remote;
  if (await exists(disk)) { e.url = local; continue; }
  if (baixados >= MAX) { e.url = remote; continue; }
  baixados++;
  try {
    const r = await fetch(remote, { headers: UA, redirect: "follow" });
    if (!r.ok) throw new Error(r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const webp = await sharp(buf).resize(64, 64, { fit: "inside", withoutEnlargement: false }).webp({ quality: 85 }).toBuffer();
    await writeFile(disk, webp);
    e.url = local;
  } catch (err) {
    falhas++;
    e.url = remote;
    (data.erros ||= []).push(`download ${k}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
await writeFile(file, JSON.stringify(data));
console.log(`escudos: ${baixados} tentados, ${falhas} falhas`);
