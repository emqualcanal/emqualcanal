// Busca automática de escudos (TheSportsDB, chave gratuita). Falhas nunca derrubam a atualização.
const BASE = process.env.SPORTSDB_BASE || "https://www.thesportsdb.com/api/v1/json/3";
const RETRY_MS = 7 * 864e5;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
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
      const r = await fetch(`${BASE}/searchteams.php?t=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const url = pick(j.teams, name, region);
      out[k] = { name, url: url ? url + "/small" : null, t: now };
    } catch (e) {
      erros.push(`escudo ${name}: ${e.message}`);
      if (old) out[k] = old;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { escudos: out, erros, consultas: calls };
}
