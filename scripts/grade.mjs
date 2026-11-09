// Lê a grade de TV (grade.csv e, opcionalmente, um CSV publicado em config.gradeUrl) e gera docs/data/grade.json.
import { readFile } from "node:fs/promises";
import { classify } from "./leagues.mjs";

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
    const [data, hora, camp, home, away, aberta, fechada, stream] = r;
    const iso = toIso(data || "", hora || "");
    if (!iso || !home || !away) { erros.push(`linha ${i + 1}: data/hora/times inválidos (${r.join(";")})`); return; }
    const c = classify(camp || "");
    items.push({
      start: iso, league: c.league || camp || "Outros campeonatos", region: c.region, flag: c.flag,
      home, away, open: split(aberta), cable: split(fechada), stream: split(stream),
    });
  });
  return { items: items.sort((a, b) => a.start.localeCompare(b.start)), erros };
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
  return { items: all.items, erros: [...erros, ...all.erros] };
}
