// Gera docs/data/lives.json com as transmissões de futebol ao vivo e agendadas.
// Mesma lógica da extensão do Chrome, rodando no GitHub Actions.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { filterReason } from "./filter.mjs";
import { classify } from "./leagues.mjs";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) {
  console.error("Defina o segredo YOUTUBE_API_KEY (Settings → Secrets and variables → Actions).");
  process.exit(1);
}
const API = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3";
const OUT = process.env.OUT_DIR || "docs/data";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const now = Number(process.env.NOW_MS) || Date.now();
const runMs = (cfg.runIntervalMin || 15) * 60000;

const handles = cfg.channels.map((s) => s.trim()).filter(Boolean);
const prio = (cfg.deepSearchChannels || []).map((s) => s.trim()).filter(Boolean);
const prioKeys = new Set(prio.map((h) => h.toLowerCase()));
const pool = handles.filter((h) => !prioKeys.has(h.toLowerCase()));

// Quantas páginas de 50 uploads ler por canal (1 unidade por página). Canais prioritários
// costumam postar muito, então a live agendada pode ficar longe do topo da lista.
const pagesDefault = Math.max(1, Math.min(10, cfg.uploadsPages || 2));
const pagesPrio = Math.max(pagesDefault, Math.min(10, cfg.uploadsPagesPriority || 4));
const pagesFor = (h) => (prioKeys.has(h.toLowerCase()) ? pagesPrio : pagesDefault);

// Estimativa da cota diária com esta configuração (limite padrão da API: 10.000 unidades).
const runsPerDay = 1440 / (cfg.runIntervalMin || 15);
const estimatedDaily = Math.round(
  runsPerDay * (handles.reduce((a, h) => a + pagesFor(h), 0) + 3) +
  prio.length * 100 * (1440 / (cfg.deepPriorityEveryMin || 120)) +
  (cfg.deepBudgetPerDay || 0)
);
console.log(`Estimativa de cota diária com esta configuração: ~${estimatedDaily} unidades (limite padrão: 10.000).`);
if (estimatedDaily > 10000) {
  console.warn("ATENÇÃO: a estimativa passa de 10.000 unidades por dia. Reduza deepSearchChannels, deepBudgetPerDay, uploadsPages ou a frequência no config.json.");
}

let quota = 0;
async function yt(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  let res = await fetch(url);
  if (res.status >= 500) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(url);
  }
  quota += path === "search" ? 100 : 1;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || String(res.status);
    const e = new Error(`${path}: ${json?.error?.message || res.status} (${reason})`);
    e.reason = reason;
    throw e;
  }
  return json;
}

// Estado anterior: lido do próprio site já publicado (ou de PREV_DIR, nos testes).
async function readPrev(name) {
  try {
    if (process.env.PREV_DIR) return JSON.parse(await readFile(`${process.env.PREV_DIR}/${name}`, "utf8"));
    if (!SITE) return null;
    const r = await fetch(`${SITE}/data/${name}?t=${now}`, { headers: { "cache-control": "no-cache" } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const prev = await readPrev("lives.json");
const cache = (await readPrev("channels.json")) || {};
const seen = (await readPrev("seen.json")) || {}; // vídeos comuns já conferidos (nunca viram live)

const ID_RE = /^UC[\w-]{22}$/;
async function resolve(handle) {
  const key = handle.toLowerCase();
  if (cache[key]) return cache[key];
  const j = await yt("channels", ID_RE.test(handle)
    ? { part: "id,snippet", id: handle }
    : { part: "id,snippet", forHandle: handle });
  const c = j.items?.[0];
  if (!c) throw new Error(`Canal não encontrado: ${handle}. Confira o @ na página do canal no YouTube ou use o ID (UC…).`);
  // A playlist de uploads tem o mesmo ID do canal, trocando "UC" por "UU".
  return (cache[key] = { id: c.id, title: c.snippet.title, uploads: "UU" + c.id.slice(2) });
}

const errors = [];
const per = {};
const wanted = new Set();
const via = new Map(); // id -> como a transmissão foi encontrada
const mark = (id, how) => { if (!via.has(id)) via.set(id, new Set()); via.get(id).add(how); wanted.add(id); };

// 1) Últimos uploads de cada canal (1 unidade por página de 50).
async function uploads(ch, pages) {
  const ids = [];
  let token;
  for (let i = 0; i < pages; i++) {
    const pl = await yt("playlistItems", {
      part: "contentDetails", playlistId: ch.uploads, maxResults: 50, ...(token ? { pageToken: token } : {})
    });
    ids.push(...(pl.items || []).map((x) => x.contentDetails.videoId));
    token = pl.nextPageToken;
    if (!token) break;
  }
  return ids;
}
await Promise.all(handles.map(async (handle) => {
  try {
    const ch = await resolve(handle);
    const ids = await uploads(ch, pagesFor(handle));
    per[handle.toLowerCase()] = { handle, title: ch.title, read: ids.length, ids: new Set(ids), deep: 0 };
    ids.forEach((id) => mark(id, "uploads"));
  } catch (e) {
    errors.push(`${handle}: ${e.message}`);
  }
}));
if (!Object.keys(per).length) {
  console.error("Nenhum canal pôde ser lido:\n" + errors.join("\n"));
  process.exit(1);
}

// 2) Busca reforçada ("próximas transmissões", 100 unidades por busca), sem estado:
//    o momento de cada busca é calculado a partir do relógio.
async function deep(handle) {
  const ch = await resolve(handle);
  const j = await yt("search", {
    part: "snippet", channelId: ch.id, type: "video", eventType: "upcoming", maxResults: 50
  });
  const found = (j.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const key = handle.toLowerCase();
  per[key] ??= { handle, title: ch.title, read: 0, ids: new Set(), deep: 0 };
  found.forEach((id) => { mark(id, "busca"); per[key].ids.add(id); });
  per[key].deep = found.length;
}

let todo = [];
if (!prev || process.env.FORCE_DEEP_ALL === "true") {
  todo = [...handles]; // primeira execução (ou pedido manual): todos os canais
} else {
  const prioEvery = (cfg.deepPriorityEveryMin || 120) * 60000;
  if (prio.length && now % prioEvery < runMs) todo.push(...prio);
  const perDay = Math.floor((cfg.deepBudgetPerDay || 0) / 100);
  if (perDay > 0 && pool.length) {
    const T = 86400000 / perDay;
    if (now % T < runMs) todo.push(pool[Math.floor(now / T) % pool.length]);
  }
}
const searched = [];
for (const handle of todo) {
  try {
    await deep(handle);
    searched.push(handle);
  } catch (e) {
    errors.push(`Busca reforçada ${handle}: ${e.message}`);
    if (e.reason === "quotaExceeded") break;
  }
}

// 3) Lives já vistas continuam sendo conferidas, mesmo que saiam da lista de uploads.
for (const v of prev?.items || []) mark(v.id, "acompanhamento");

// 4) Detalhes das transmissões (1 unidade a cada 50 vídeos), só dos que ainda não foram descartados.
const toFetch = [...wanted].filter((id) => !seen[id]);
const videos = [];
for (let i = 0; i < toFetch.length; i += 50) {
  try {
    const j = await yt("videos", {
      part: "snippet,liveStreamingDetails", id: toFetch.slice(i, i + 50).join(",")
    });
    videos.push(...(j.items || []));
  } catch (e) {
    // Melhor manter o site anterior do que publicar uma lista incompleta.
    console.error("Falha ao consultar os vídeos: " + e.message);
    process.exit(1);
  }
}
const byId = new Map(videos.map((v) => [v.id, v]));

// 5) Filtro.
const staleMs = (cfg.staleUpcomingHours || 6) * 3600000;
const items = [];
const rejected = [];
for (const raw of videos) {
  const state = raw.snippet?.liveBroadcastContent; // upcoming | live | none
  if (state !== "upcoming" && state !== "live") {
    seen[raw.id] = now; // vídeo comum: não precisa ser consultado de novo
    continue;
  }
  const lsd = raw.liveStreamingDetails || {};
  const th = raw.snippet.thumbnails || {};
  const v = {
    id: raw.id,
    title: raw.snippet.title,
    channel: raw.snippet.channelTitle,
    channelId: raw.snippet.channelId,
    state,
    scheduled: lsd.scheduledStartTime || null,
    started: lsd.actualStartTime || null,
    thumbnail: (th.medium || th.default || {}).url || null
  };
  let reason = null;
  if (state === "upcoming") {
    if (!v.scheduled) reason = "sem horário agendado";
    else if (now - Date.parse(v.scheduled) > staleMs) reason = "agendada, mas não iniciou";
  }
  reason ||= filterReason(v.title, cfg);
  if (reason) rejected.push({ ...v, reason });
  else items.push({ ...v, ...classify(v.title) });
}
for (const [id, ts] of Object.entries(seen)) {
  if (now - ts > 30 * 86400000) delete seen[id];
}
items.sort((a, b) => {
  if (a.state !== b.state) return a.state === "live" ? -1 : 1;
  return a.state === "live"
    ? Date.parse(b.started || 0) - Date.parse(a.started || 0)
    : Date.parse(a.scheduled) - Date.parse(b.scheduled);
});

// 6) Saída.
const generatedAt = new Date(now).toISOString();
const has = (v, how) => via.get(v.id)?.has(how);
const descobertas = {
  uploads: items.filter((v) => has(v, "uploads")).length,
  soBusca: items.filter((v) => !has(v, "uploads") && has(v, "busca")).length,
  soAcompanhamento: items.filter((v) => !has(v, "uploads") && !has(v, "busca")).length
};
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/lives.json`, JSON.stringify({ generatedAt, quotaUsed: quota, items }));
await writeFile(`${OUT}/channels.json`, JSON.stringify(cache));
await writeFile(`${OUT}/seen.json`, JSON.stringify(seen));
await writeFile(`${OUT}/debug.json`, JSON.stringify({
  generatedAt, quotaUsed: quota, estimatedDaily, errors, buscaReforcada: searched,
  descobertas,
  // Lives que só a busca reforçada achou: a lista de uploads não mostrou. Útil para decidir quais canais priorizar.
  soPelaBusca: items.filter((v) => !has(v, "uploads") && has(v, "busca")).map((v) => `${v.channel}: ${v.title}`),
  semCampeonato: items.filter((v) => v.region === "Outros").map((v) => v.title),
  channels: Object.values(per).map((d) => {
    let lives = 0;
    d.ids.forEach((id) => {
      const st = byId.get(id)?.snippet?.liveBroadcastContent;
      if (st === "upcoming" || st === "live") lives++;
    });
    return { handle: d.handle, title: d.title, read: d.read, lives, deep: d.deep };
  }),
  rejected
}, null, 1));

console.log(`OK: ${items.filter((v) => v.state === "live").length} ao vivo, ` +
  `${items.filter((v) => v.state !== "live").length} agendadas, ${rejected.length} descartadas. ` +
  `Cota usada: ${quota} unidades. Buscas reforçadas: ${searched.length}. Erros: ${errors.length}.`);
console.log(`Encontradas pela lista de uploads: ${descobertas.uploads}; só pela busca reforçada: ${descobertas.soBusca}; só pelo acompanhamento: ${descobertas.soAcompanhamento}.`);
errors.forEach((e) => console.log("  aviso: " + e));
