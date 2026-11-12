// Lê a grade de TV (grade.csv e, opcionalmente, um CSV publicado em config.gradeUrl) e gera docs/data/grade.json.
import { readFile } from "node:fs/promises";
import { classify, teamFix } from "./leagues.mjs";

const split = (s) => String(s || "").split(/[\/|]/).map((x) => x.trim()).filter(Boolean);

function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("#")) || "";
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); rows.push(out.map((x) => x.trim()));
  }
  return rows;
}

// "dd/mm/aaaa" ou "aaaa-mm-dd" + "HH:MM" (horário de Brasília, UTC-3) -> ISO
function toIso(d, h) {
  let y, m, day;
  let r = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (r) { day = +r[1]; m = +r[2]; y = +r[3]; }
  else if ((r = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +r[1]; m = +r[2]; day = +r[3]; }
  else return null;
  const t = h.match(/^(\d{1,2})[:h](\d{2})?/);
  if (!t) return null;
  const ms = Date.UTC(y, m - 1, day, +t[1] + 3, +(t[2] || 0));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function parseGrade(text) {
  const rows = parseCsv(text), items = [], erros = [];
  rows.forEach((r, i) => {
    if (/^data$/i.test(r[0])) return; // cabeçalho
    const [data, hora, camp, home, away, aberta, fechada, stream, rodada] = r;
    const iso = toIso(data || "", hora || "");
    if (!iso || !home || !away) { erros.push(`linha ${i + 1}: data/hora/times inválidos (${r.join(";")})`); return; }
    const c = classify(camp || "");
    items.push({
      start: iso, league: c.league || camp || "Outros campeonatos", region: c.region, flag: c.flag,
      home: teamFix(c.league, home), away: teamFix(c.league, away), round: rodada || null, open: split(aberta), cable: split(fechada), stream: split(stream),
    });
  });
  // Jogo repetido na grade: mesmos times, no mesmo dia e no mesmo campeonato/categoria (ordem dos times não importa).
  // Campeonatos ou categorias diferentes (Sub-20, Feminino, outra copa) NÃO são unidos. Campeonato em branco não bloqueia a união.
  const nk = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const uniq = (a, b) => { const out = [...a]; b.forEach((n) => { if (!out.some((o) => nk(o) === nk(n))) out.push(n); }); return out; };
  const UNK = "Outros campeonatos";
  const seen = new Map(), merged = [], avisos = [];
  for (const it of items) {
    const day = new Date(new Date(it.start).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
    const k = day + "|" + [nk(it.home), nk(it.away)].sort().join("|");
    const list = seen.get(k) || [];
    const cand = list.filter((p) => p.league === it.league || p.league === UNK || it.league === UNK);
    const prev = it.league === UNK && cand.length > 1 ? null : cand[0]; // sem campeonato e mais de uma categoria possível: não adivinha
    if (!prev) { list.push(it); seen.set(k, list); merged.push(it); continue; }
    prev.open = uniq(prev.open, it.open); prev.cable = uniq(prev.cable, it.cable); prev.stream = uniq(prev.stream, it.stream);
    if (!prev.round && it.round) prev.round = it.round;
    if (prev.league === UNK && it.league !== UNK) { prev.league = it.league; prev.region = it.region; prev.flag = it.flag; }
    if (it.start < prev.start) prev.start = it.start;
    avisos.push(`jogo repetido unido: ${it.home} x ${it.away} (${day}, ${prev.league})`);
  }
  return { items: merged.sort((a, b) => a.start.localeCompare(b.start)), erros, avisos };
}

export async function loadGrade(url) {
  const parts = [];
  try { parts.push(await readFile(new URL("../grade.csv", import.meta.url), "utf8")); } catch {}
  const erros = [];
  if (url) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); parts.push(await r.text()); }
    catch (e) { erros.push(`gradeUrl: ${e.message}`); }
  }
  const all = parseGrade(parts.join("\n"));
  return { items: all.items, erros: [...erros, ...all.erros], avisos: all.avisos };
}
