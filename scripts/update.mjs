// Gera docs/data/lives.json com as transmissões de futebol ao vivo e agendadas.
// Mesma lógica da extensão do Chrome, rodando no GitHub Actions.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { filterReason } from "./filter.mjs";

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
const handles = cfg.channels.map((s) => s.trim()).filter(Boolean);

// 1) Últimos 50 uploads de cada canal (1 unidade por canal).
await Promise.all(handles.map(async (handle) => {
  try {
    const ch = await resolve(handle);
    const pl = await yt("playlistItems", { part: "contentDetails", playlistId: ch.uploads, maxResults: 50 });
    const ids = (pl.items || []).map((i) => i.contentDetails.videoId);
    per[handle.toLowerCase()] = { handle, title: ch.title, read: ids.length, ids: new Set(ids), deep: 0 };
    ids.forEach((id) => wanted.add(id));
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
    part: "snippet", channelId: ch.id, type: "video", eventType: "upcoming", maxResults: 25
  });
  const found = (j.items || []).map((i) => i.id?.videoId).filter(Boolean);
  const key = handle.toLowerCase();
  per[key] ??= { handle, title: ch.title, read: 0, ids: new Set(), deep: 0 };
  found.forEach((id) => { wanted.add(id); per[key].ids.add(id); });
  per[key].deep = found.length;
}

const prio = (cfg.deepSearchChannels || []).map((s) => s.trim()).filter(Boolean);
const prioKeys = new Set(prio.map((h) => h.toLowerCase()));
const pool = handles.filter((h) => !prioKeys.has(h.toLowerCase()));
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
for (const v of prev?.items || []) wanted.add(v.id);

// 4) Detalhes das transmissões (1 unidade a cada 50 vídeos).
const all = [...wanted];
const videos = [];
for (let i = 0; i < all.length; i += 50) {
  try {
    const j = await yt("videos", {
      part: "snippet,liveStreamingDetails", id: all.slice(i, i + 50).join(",")
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
  if (state !== "upcoming" && state !== "live") continue;
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
  (reason ? rejected : items).push(reason ? { ...v, reason } : v);
}
items.sort((a, b) => {
  if (a.state !== b.state) return a.state === "live" ? -1 : 1;
  return a.state === "live"
    ? Date.parse(b.started || 0) - Date.parse(a.started || 0)
    : Date.parse(a.scheduled) - Date.parse(b.scheduled);
});

// 6) Saída.
const generatedAt = new Date(now).toISOString();
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/lives.json`, JSON.stringify({ generatedAt, quotaUsed: quota, items }));
await writeFile(`${OUT}/channels.json`, JSON.stringify(cache));
await writeFile(`${OUT}/debug.json`, JSON.stringify({
  generatedAt, quotaUsed: quota, errors, buscaReforcada: searched,
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
errors.forEach((e) => console.log("  aviso: " + e));
