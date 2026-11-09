// Gera docs/data/lives.json com as transmissões de futebol ao vivo e agendadas.
// Mesma lógica da extensão do Chrome, rodando no GitHub Actions.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { filterReason } from "./filter.mjs";
import { classify } from "./leagues.mjs";
import { loadGrade } from "./grade.mjs";
import { buildEscudos } from "./escudos.mjs";

const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) {
  console.error("Defina o segredo YOUTUBE_API_KEY (Settings → Secrets and variables → Actions).");
  process.exit(1);
}
const API = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3";
const RSS = process.env.RSS_BASE || "https://www.youtube.com/feeds/videos.xml";
const OUT = process.env.OUT_DIR || "docs/data";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const now = Number(process.env.NOW_MS) || Date.now();
const runMs = (cfg.runIntervalMin || 15) * 60000;

const handles = cfg.channels.map((s) => s.trim()).filter(Boolean);
const prio = (cfg.deepSearchChannels || []).map((s) => s.trim()).filter(Boolean);
const prioKeys = new Set(prio.map((h) => h.toLowerCase()));
const pool = handles.filter((h) => !prioKeys.has(h.toLowerCase()));
const isPrio = (h) => prioKeys.has(h.toLowerCase());

// Quantas páginas de 50 vídeos ler por canal (1 unidade por página).
//  - uploads: os vídeos mais recentes do canal;
//  - lives:   a lista de transmissões ao vivo do canal (playlist "UULV…"), que não se mistura com cortes e shorts.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const num = (v, d) => (typeof v === "number" ? v : d);
const upPages = (h) => clamp(isPrio(h) ? num(cfg.uploadsPagesPriority, 1) : num(cfg.uploadsPages, 1), 0, 10);
const livePages = (h) => clamp(isPrio(h) ? num(cfg.livePagesPriority, 2) : num(cfg.livePages, 1), 0, 20);
// A lista de lives é lida em mais páginas enquanto as transmissões mais antigas da página ainda forem
// recentes (liveHorizonDays), até o limite abaixo. Canais com muitas lives agendadas precisam disso.
const liveMax = (h) => Math.max(livePages(h), clamp(isPrio(h) ? num(cfg.liveMaxPagesPriority, 8) : num(cfg.liveMaxPages, 3), 0, 20));
const horizonDays = num(cfg.liveHorizonDays, 10);
const deepOn = cfg.deepSearch !== false; // busca reforçada (100 unidades por busca); ver config.json
const useRss = cfg.useRss === true; // o YouTube costuma responder 404 ao feed RSS a partir do GitHub; desligado por padrão

// Estimativa da cota diária com esta configuração (limite padrão da API: 10.000 unidades).
const runsPerDay = 1440 / (cfg.runIntervalMin || 15);
const estimatedDaily = Math.round(
  runsPerDay * (handles.reduce((a, h) => a + upPages(h) + livePages(h), 0) + 3) +
  (deepOn ? prio.length * 100 * (1440 / (cfg.deepPriorityEveryMin || 120)) + (cfg.deepBudgetPerDay || 0) : 0)
);
const estimatedMax = Math.round(runsPerDay * (handles.reduce((a, h) => a + upPages(h) + liveMax(h), 0) + 3) + (estimatedDaily - runsPerDay * (handles.reduce((a, h) => a + upPages(h) + livePages(h), 0) + 3)));
console.log(`Estimativa de cota diária com esta configuração: ~${estimatedDaily} unidades (até ~${estimatedMax} se todos os canais usarem o máximo de páginas; limite padrão: 10.000).`);
if (estimatedDaily > 10000) {
  console.warn("ATENÇÃO: a estimativa passa de 10.000 unidades por dia. Reduza deepSearchChannels, deepBudgetPerDay, uploadsPages, livePages ou a frequência no config.json.");
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
const via = new Map(); // id -> métodos que encontraram a transmissão
const mark = (id, how) => { if (!via.has(id)) via.set(id, new Set()); via.get(id).add(how); wanted.add(id); };
const METHODS = ["uploads", "uulv", "rss", "busca"];
const metodos = { uulv: { ok: 0, falhas: 0, erro: null }, rss: { ok: 0, falhas: 0, erro: null } };

// Páginas de uma playlist (1 unidade por página de 50). Depois de minPages, continua enquanto a transmissão
// mais antiga da página ainda for mais recente que o horizonte (horizon), até maxPages.
async function playlist(playlistId, minPages, maxPages = minPages, horizon = null) {
  const ids = [];
  let token;
  let pages = 0;
  for (let i = 0; i < maxPages; i++) {
    const pl = await yt("playlistItems", {
      part: "contentDetails", playlistId, maxResults: 50, ...(token ? { pageToken: token } : {})
    });
    pages++;
    const items = pl.items || [];
    ids.push(...items.map((x) => x.contentDetails.videoId));
    token = pl.nextPageToken;
    if (!token) break;
    if (i + 1 >= minPages) {
      const dates = items.map((x) => Date.parse(x.contentDetails.videoPublishedAt || "")).filter(Number.isFinite);
      if (horizon === null || !dates.length || Math.min(...dates) < horizon) break;
    }
  }
  return { ids, pages };
}

// Feed RSS público do canal: não gasta cota. Traz só os ~15 vídeos mais recentes.
async function rssIds(channelId) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${RSS}?channel_id=${channelId}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`RSS ${r.status}`);
    const xml = await r.text();
    return [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
  } finally {
    clearTimeout(timer);
  }
}

// 1) Descoberta por canal: uploads recentes + lista de lives + feed RSS (opcional).
await Promise.all(handles.map(async (handle) => {
  try {
    const ch = await resolve(handle);
    const entry = (per[handle.toLowerCase()] = {
      handle, title: ch.title, read: 0, ids: new Set(), deep: 0, pagesLive: 0,
      by: Object.fromEntries(METHODS.map((m) => [m, new Set()]))
    });
    const add = (how, ids) => ids.forEach((id) => { entry.by[how].add(id); entry.ids.add(id); mark(id, how); });

    const tasks = [];
    if (upPages(handle) > 0) {
      tasks.push(playlist(ch.uploads, upPages(handle)).then((r) => { entry.read = r.ids.length; add("uploads", r.ids); }));
    }
    if (livePages(handle) > 0) {
      tasks.push(
        playlist("UULV" + ch.id.slice(2), livePages(handle), liveMax(handle), now - horizonDays * 86400000)
          .then((r) => { metodos.uulv.ok++; entry.pagesLive = r.pages; add("uulv", r.ids); })
          .catch((e) => { metodos.uulv.falhas++; metodos.uulv.erro ??= e.message; })
      );
    }
    if (useRss) {
      tasks.push(
        rssIds(ch.id)
          .then((ids) => { metodos.rss.ok++; add("rss", ids); })
          .catch((e) => { metodos.rss.falhas++; metodos.rss.erro ??= e.message; })
      );
    }
    await Promise.all(tasks);
  } catch (e) {
    errors.push(`${handle}: ${e.message}`);
  }
}));
if (!Object.keys(per).length) {
  console.error("Nenhum canal pôde ser lido:\n" + errors.join("\n"));
  process.exit(1);
}
for (const [nome, m] of Object.entries(metodos)) {
  if (m.falhas) errors.push(`Método “${nome}” falhou em ${m.falhas} canal(is) (${m.erro}).`);
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
  per[key] ??= {
    handle, title: ch.title, read: 0, ids: new Set(), deep: 0, pagesLive: 0,
    by: Object.fromEntries(METHODS.map((m) => [m, new Set()]))
  };
  found.forEach((id) => { mark(id, "busca"); per[key].ids.add(id); per[key].by.busca.add(id); });
  per[key].deep = found.length;
}

let todo = [];
if (process.env.FORCE_DEEP_ALL === "true") {
  todo = [...handles]; // pedido manual (“busca completa”): todos os canais, mesmo com a busca desligada
} else if (!deepOn) {
  todo = [];
} else if (!prev) {
  todo = [...handles]; // primeira execução: todos os canais
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

// 3) Lives já vistas continuam sendo conferidas, mesmo que saiam das listas acima.
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
  reason ||= filterReason(v.title, cfg, raw.snippet.description || "");
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

// 6) Saída e diagnóstico: de que forma cada transmissão foi encontrada.
const generatedAt = new Date(now).toISOString();
const has = (v, how) => via.get(v.id)?.has(how);
const descobertas = Object.fromEntries([...METHODS, "acompanhamento"].map((m) => [m, items.filter((v) => has(v, m)).length]));
// "Só por um método": ignora a marca "acompanhamento" (ela só indica que a live já estava no site antes).
const core = (v) => [...via.get(v.id)].filter((x) => x !== "acompanhamento");
const soPor = (m) => items.filter((v) => core(v).length === 1 && core(v)[0] === m);
const exclusivas = Object.fromEntries(METHODS.map((m) => [m, soPor(m).length]));
exclusivas.acompanhamento = items.filter((v) => core(v).length === 0).length;
const titulosSo = (m) => soPor(m).map((v) => `${v.channel}: ${v.title}`);
await mkdir(OUT, { recursive: true });
const grade = await loadGrade(cfg.gradeUrl);
await writeFile(`${OUT}/grade.json`, JSON.stringify({ generatedAt, items: grade.items, erros: grade.erros }));
let escData = { escudos: {}, erros: [], consultas: 0 };
try {
  const nm = new Map();
  const add = (n, r) => { if (n && !nm.has(n)) nm.set(n, r); };
  items.forEach((v) => { add(v.home, v.region); add(v.away, v.region); });
  grade.items.forEach((g) => { add(g.home, g.region); add(g.away, g.region); });
  let manual = {};
  try { manual = JSON.parse(await readFile(new URL("../escudos-manual.json", import.meta.url), "utf8")); delete manual._exemplo; } catch {}
  const prevEsc = (await readPrev("escudos.json"))?.escudos || {};
  escData = await buildEscudos([...nm].map(([name, region]) => ({ name, region })), prevEsc, manual, { max: cfg.escudosPorExecucao ?? 20 });
} catch (e) { escData.erros.push(String(e.message || e)); }
await writeFile(`${OUT}/escudos.json`, JSON.stringify({ generatedAt, escudos: escData.escudos, erros: escData.erros }));
await writeFile(`${OUT}/lives.json`, JSON.stringify({ generatedAt, quotaUsed: quota, items }));
await writeFile(`${OUT}/channels.json`, JSON.stringify(cache));
await writeFile(`${OUT}/seen.json`, JSON.stringify(seen));
await writeFile(`${OUT}/debug.json`, JSON.stringify({
  generatedAt, quotaUsed: quota, estimatedDaily, errors, buscaReforcada: searched,
  metodos, descobertas, exclusivas,
  // Lives que só um método achou: mostram qual método realmente faz diferença.
  soPelaBusca: titulosSo("busca"),
  soPelaListaDeLives: titulosSo("uulv"),
  soPeloRss: titulosSo("rss"),
  semCampeonato: items.filter((v) => v.region === "Outros").map((v) => v.title),
  channels: Object.values(per).map((d) => {
    const live = (id) => ["upcoming", "live"].includes(byId.get(id)?.snippet?.liveBroadcastContent);
    const achadasPor = Object.fromEntries(METHODS.map((m) => [m, [...d.by[m]].filter(live).length]));
    return {
      handle: d.handle, title: d.title, read: d.read,
      lives: [...d.ids].filter(live).length, deep: d.deep, achadasPor, paginasListaDeLives: d.pagesLive
    };
  }),
  rejected
}, null, 1));

console.log(`OK: ${items.filter((v) => v.state === "live").length} ao vivo, ` +
  `${items.filter((v) => v.state !== "live").length} agendadas, ${rejected.length} descartadas. ` +
  `Cota usada: ${quota} unidades. Buscas reforçadas: ${searched.length}. Erros: ${errors.length}.`);
console.log("Transmissões por método (uploads / lista de lives / RSS / busca): " +
  `${descobertas.uploads} / ${descobertas.uulv} / ${descobertas.rss} / ${descobertas.busca}; ` +
  `só por um método: ${exclusivas.uploads} / ${exclusivas.uulv} / ${exclusivas.rss} / ${exclusivas.busca}.`);
errors.forEach((e) => console.log("  aviso: " + e));
