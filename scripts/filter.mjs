// Mesma lógica de filtro da extensão do Chrome, com algumas proteções a mais.
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Todas as palavras da lista que aparecem inteiras no texto.
function findMatches(text, words) {
  return (words || []).filter((w) => {
    const k = norm((w || "").trim());
    if (!k) return false;
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(k)}(?:[^a-z0-9]|$)`).test(text);
  });
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
  // vôlei e outras modalidades
  "volei", "voleibol", "futevolei", "levantou cortou", "levantou, cortou", "superliga feminina", "superliga masculina",
  "handebol", "tenis", "rugby", "beisebol", "mlb", "nhl", "hoquei", "ufc", "mma", "boxe",
  // esportes eletrônicos
  "cblol", "league of legends", "valorant", "free fire", "counter-strike", "cs2", "esports", "e-sports",
  // programas, bastidores e conteúdo que não é a partida
  "geral cazetv", "geral caze", "cazetv geral", "jogo aberto", "podcast", "programa", "linha de passe",
  "coletiva", "entrevista", "bastidores", "melhores momentos", "mercado da bola",
  // talk shows, treinos e conversas (ex.: "SELEÇÃO TREINA... | Denilson Show")
  "show", "treina", "treinam", "treinamento", "treino", "resenha", "debate", "mesa redonda", "bate papo", "bate-papo",
  "react", "reacao", "pre jogo", "pre-jogo", "pos jogo", "pos-jogo", "denilson", "debatem", "discutem", "opinam",
  // torneios de fut7/society e de criadores de conteúdo
  "cazetv fc", "caze tv fc", "fut7", "fut 7", "futebol 7", "futebol society", "society",
  // programas de canais de esporte (ESPN Brasil etc.)
  "futebol no mundo", "f show", "fshow", "sportscenter", "espn fc", "bola da vez", "fim de papo", "resenha espn"
];

// Palavras que só descartam se o título NÃO indicar que é um jogo de verdade (ex.: "Jogo-treino: A x B", amistoso).
const GAME_TRAINING = /\b(jogo[ -]treino|amistoso)\b/;

// Palavras que só descartam a live quando o título NÃO diz que ela é com imagens
// (ex.: "AO VIVO COM IMAGENS: A x B E NARRAÇÃO EM PORTUGUÊS" é a transmissão oficial).
const SOFT = new Set(["narracao", "comentando", "comentarios"]);

// Se a descrição do vídeo falar duas vezes ou mais de outra modalidade, a live é descartada.
const DESC_SPORTS = [
  [/\bvolei(?:bol)?\b/g, "vôlei"], [/\bbasquete\b/g, "basquete"], [/\bfutsal\b/g, "futsal"],
  [/\b(?:nfl|futebol americano)\b/g, "futebol americano"], [/\bhandebol\b/g, "handebol"]
];

// null = passa no filtro; texto = motivo de ter sido descartada.
// Canais cujas lives são quase sempre programas de estúdio: só entram se o título disser "com imagens".
const IMAGES_ONLY = ["espn brasil"];

export function filterReason(title, cfg, description = "", channel = "", allowImagesOnly = false) {
  const t = norm(title);
  const withImages = /\bcom imagens?\b/.test(t) && !/\bsem imagens?\b/.test(t);
  if (!withImages && !allowImagesOnly && [...IMAGES_ONLY, ...(cfg.imagesOnlyChannels || [])].some((c) => norm(channel).includes(norm(c)))) {
    return "canal de programas: só entra com “com imagens” no título";
  }
  const hits = findMatches(t, [...ALWAYS_EXCLUDE, ...(cfg.excludeKeywords || [])])
    .filter((w) => !(withImages && SOFT.has(norm(w.trim()))))
    .filter((w) => !(/^treino$/.test(norm(w.trim())) && GAME_TRAINING.test(t)));
  if (hits.length) return `contém “${hits[0].trim()}”`;
  const matchup = MATCHUP.test(t);
  if (cfg.requireMatchup && !matchup) return "título sem “Time x Time”";
  if (cfg.requireKeyword && !matchup &&
      !cfg.keywords.some((k) => k.trim() && t.includes(norm(k.trim())))) {
    return "sem palavra-chave de futebol";
  }
  const d = norm(description || "");
  for (const [re, label] of DESC_SPORTS) {
    if ((d.match(re) || []).length >= 2) return `descrição fala de ${label}`;
  }
  return null;
}
