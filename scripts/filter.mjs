// Mesma lógica de filtro da extensão do Chrome.
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findMatch(text, words) {
  return (words || []).find((w) => {
    const k = norm((w || "").trim());
    if (!k) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(k)}(?:[^a-z0-9]|$)`).test(text);
  }) || null;
}

// "Time A x Time B", "Time A vs Time B", "Time A 2x1 Time B"
const MATCHUP = /\s(x|×|vs\.?)\s|\d\s?[x×]\s?\d/;

// Palavras sempre ignoradas, além das do config.json.
// Outras modalidades e conteúdos que não são a transmissão ao vivo de uma partida de futebol.
const ALWAYS_EXCLUDE = [
  // futsal e futebol de salão
  "futsal", "futebol de salao", "lnf", "liga nacional de futsal",
  // futebol americano e basquete
  "nfl", "futebol americano", "ncaa", "super bowl", "nba", "wnba", "nbb", "basquete",
  // programas, bastidores e conteúdo que não é a partida
  "geral cazetv", "geral caze", "cazetv geral", "jogo aberto", "podcast", "programa",
  "coletiva", "entrevista", "bastidores", "melhores momentos", "mercado da bola"
];

// null = passa no filtro; texto = motivo de ter sido descartada.
export function filterReason(title, cfg) {
  const t = norm(title);
  const hit = findMatch(t, [...ALWAYS_EXCLUDE, ...(cfg.excludeKeywords || [])]);
  if (hit) return `contém “${hit.trim()}”`;
  const matchup = MATCHUP.test(t);
  if (cfg.requireMatchup && !matchup) return "título sem “Time x Time”";
  if (cfg.requireKeyword && !matchup &&
      !cfg.keywords.some((k) => k.trim() && t.includes(norm(k.trim())))) {
    return "sem palavra-chave de futebol";
  }
  return null;
}
