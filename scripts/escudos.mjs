// Busca automática de escudos: Wikidata (principal, sem chave) e TheSportsDB (reserva). Falhas nunca derrubam a atualização.
const BASE = process.env.SPORTSDB_BASE || "https://www.thesportsdb.com/api/v1/json/3";
const RETRY_MS = 7 * 864e5;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const WD = process.env.WIKIDATA_API || "https://www.wikidata.org/w/api.php";
const UA = { "user-agent": "EQC-lives/1.0 (site de agenda de futebol; escudos via Wikidata)" };
const Q_CLUB = "Q476028", Q_FOOTBALL = "Q2736", Q_BRAZIL = "Q155";
const claimIds = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

async function wikidataBadge(name, region) {
  const n = norm(name);
  const sr = await (await fetch(`${WD}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=pt&uselang=pt&type=item&limit=10&format=json`, { headers: UA })).json();
  const ids = (sr.search || []).map((x) => x.id);
  if (!ids.length) return null;
  const ge = await (await fetch(`${WD}?action=wbgetentities&ids=${ids.join("|")}&props=claims|labels|aliases&languages=pt|en&format=json`, { headers: UA })).json();
  let best = null, bs = 0;
  for (const id of ids) {
    const e = ge.entities?.[id];
    if (!e) continue;
    const logo = e.claims?.P154?.[0]?.mainsnak?.datavalue?.value;
    if (!logo || !/\.(svg|png|jpe?g|webp)$/i.test(logo)) continue;
    const isClub = claimIds(e, "P31").includes(Q_CLUB) || claimIds(e, "P641").includes(Q_FOOTBALL);
    if (!isClub) continue;
    const labels = [e.labels?.pt?.value, e.labels?.en?.value, ...(e.aliases?.pt || []).map((a) => a.value), ...(e.aliases?.en || []).map((a) => a.value)].map(norm).filter(Boolean);
    let sc = 5;
    if (labels.includes(n)) sc += 10; else if (labels.some((x) => x.startsWith(n + " ") || x.includes(" " + n + " ") || x.endsWith(" " + n))) sc += 5; else continue;
    if (labels.some((x) => /feminin|women|\bw$/.test(x)) && !/feminin|women/.test(n)) sc -= 6;
    const ctry = [...claimIds(e, "P17"), ...claimIds(e, "P495")];
    if (region === "Brasil") sc += ctry.includes(Q_BRAZIL) ? 4 : -2;
    if (sc > bs) { bs = sc; best = logo; }
  }
  return best ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(best.replace(/ /g, "_"))}?width=80` : null;
}

const COUNTRY = { Brasil: "brazil", Europa: null, "América do Sul": null };

function pick(teams, name, region) {
  const n = norm(name);
  let best = null, bs = 0;
  for (const t of teams || []) {
    if (t.strSport && t.strSport !== "Soccer") continue;
    const badge = t.strBadge || t.strTeamBadge;
    if (!badge) continue;
    const names = [t.strTeam, t.strTeamShort, t.strAlternate, ...(t.strAlternate || "").split(",")].map(norm).filter(Boolean);
    let s = 0;
    if (names.includes(n)) s += 10; else if (names.some((x) => x.startsWith(n + " ") || n.startsWith(x + " "))) s += 4; else continue;
    if (t.strGender && t.strGender !== "Male") s -= 3;
    const want = COUNTRY[region];
    if (want && norm(t.strCountry) === want) s += 3;
    if (s > bs) { bs = s; best = badge; }
  }
  return best;
}

// names: [{name, region}]; prev: cache anterior {nome:{url,t}}; manual: {nome:url}
export async function buildEscudos(names, prev = {}, manual = {}, { max = 20, now = Date.now() } = {}) {
  const out = {}, erros = [];
  let calls = 0;
  for (const { name, region } of names) {
    const k = norm(name);
    if (!k) continue;
    const man = Object.entries(manual).find(([m]) => norm(m) === k);
    if (man) { out[k] = { name, url: man[1], t: now, manual: true }; continue; }
    const old = prev[k];
    if (old && (old.url || now - old.t < RETRY_MS)) { out[k] = old; continue; }
    if (calls >= max) { if (old) out[k] = old; continue; }
    calls++;
    try {
      let url = null, src = null;
      try { url = await wikidataBadge(name, region); if (url) src = "wikidata"; } catch (e) { erros.push(`wikidata ${name}: ${e.message}`); }
      if (!url) {
        const r = await fetch(`${BASE}/searchteams.php?t=${encodeURIComponent(name)}`);
        if (!r.ok) throw new Error(r.status);
        const b = pick((await r.json()).teams, name, region);
        if (b) { url = b + "/small"; src = "thesportsdb"; }
      }
      out[k] = { name, url, src, t: now };
    } catch (e) {
      erros.push(`escudo ${name}: ${e.message}`);
      if (old) out[k] = old;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { escudos: out, erros, consultas: calls };
}
