// Descobre campeonato, região, rodada e times a partir do título da transmissão.
// Para incluir um campeonato novo, acrescente uma linha em RULES (ou em NAT/STATES).

const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const L = (league, region, flag = null) => ({ league, region, flag });

// Seleções, torneios internacionais e campeonatos, em ordem de prioridade (o primeiro que casar vale).
const RULES = [
  [/champions league|liga dos campeoes|uefa champions/, "Champions League", "Europa", "eu"],
  [/europa league|liga europa/, "Europa League", "Europa", "eu"],
  [/conference league|liga conferencia/, "Conference League", "Europa", "eu"],
  [/supercopa da uefa|uefa super cup/, "Supercopa da UEFA", "Europa", "eu"],
  [/youth league/, "UEFA Youth League", "Europa", "eu"],
  [/mundial sub|copa do mundo sub|fifa u-?\d\d|world cup u-?\d\d/, "Mundial Sub-20", "Internacional"],
  [/libertadores/, "Libertadores", "América do Sul"],
  [/sul-?americana|sudamericana/, "Sul-Americana", "América do Sul"],
  [/recopa/, "Recopa Sul-Americana", "América do Sul"],
  [/copa america/, "Copa América", "Internacional"],
  [/eliminatorias/, "Eliminatórias", "Internacional"],
  [/copa do mundo|world cup/, "Copa do Mundo", "Internacional"],
  [/eurocopa|euro 20/, "Eurocopa", "Internacional"],
  [/amistoso|data fifa/, "Amistosos", "Internacional"],
  [/mundial de clubes|club world cup/, "Mundial de Clubes", "Internacional"],
  [/\bwsl\b|women.?s super league/, "Campeonato Inglês", "Europa", "gb-eng"],
  [/premier league/, "Campeonato Inglês", "Europa", "gb-eng"],
  [/\bfa cup\b|copa da inglaterra/, "FA Cup", "Europa", "gb-eng"],
  [/carabao|efl cup|copa da liga inglesa/, "Copa da Liga Inglesa", "Europa", "gb-eng"],
  [/\bchampionship\b/, "EFL Championship", "Europa", "gb-eng"],
  [/copa del rey|copa do rei/, "Copa do Rei", "Europa", "es"],
  [/segunda divisao espanhola|\bla ?liga 2\b|hypermotion|segunda division/, "Segunda Divisão Espanhola", "Europa", "es"],
  [/\bla ?liga\b|campeonato espanhol/, "Campeonato Espanhol", "Europa", "es"],
  [/\b2\.? ?bundesliga|bundesliga 2(?![\d/])/, "2. Bundesliga", "Europa", "de"],
  [/\bdfb\b|copa da alemanha/, "Copa da Alemanha", "Europa", "de"],
  [/bundesliga|campeonato alemao/, "Campeonato Alemão", "Europa", "de"],
  [/ligue 2/, "Ligue 2", "Europa", "fr"],
  [/coupe de france|copa da franca/, "Copa da França", "Europa", "fr"],
  [/ligue 1|campeonato frances/, "Campeonato Francês", "Europa", "fr"],
  [/taca de portugal|copa de portugal/, "Taça de Portugal", "Europa", "pt"],
  [/taca da liga/, "Taça da Liga", "Europa", "pt"],
  [/liga portugal 2|segunda liga/, "Liga Portugal 2", "Europa", "pt"],
  [/liga portugal|primeira liga|campeonato portugues|liga betclic|liga bwin/, "Campeonato Português", "Europa", "pt"],
  [/eredivisie/, "Campeonato Holandês", "Europa", "nl"],
  [/super lig/, "Campeonato Turco", "Europa", "tr"],
  [/\bmls\b|major league soccer/, "MLS", "América do Norte", "us"],
  [/liga mx|campeonato mexicano|america-mex|\bunam\b|\bpumas\b|\bchivas\b|cruz azul|rayados|pachuca|santos laguna|\bxolos\b|\btoluca\b|\bnecaxa\b|club leon|\bqueretaro\b|mazatlan fc/, "Campeonato Mexicano", "América do Norte", "mx"],
  [/concacaf/, "Concacaf", "América do Norte"],
  [/\bnwsl\b/, "NWSL", "Feminino", "us"],
  [/saudi pro league|roshn|campeonato saudita/, "Campeonato Saudita", "Ásia", "sa"],
  [/\bj-?league\b|\bj1 league\b/, "J-League", "Ásia", "jp"],
  [/eliteserien|tippeligaen/, "Campeonato Norueguês", "Europa", "no"],
  [/allsvenskan/, "Campeonato Sueco", "Europa", "se"],
  [/superligaen|superliga dinamarquesa/, "Campeonato Dinamarquês", "Europa", "dk"],
  [/ekstraklasa/, "Campeonato Polonês", "Europa", "pl"],
  [/jupiler|pro league belga/, "Campeonato Belga", "Europa", "be"],
  [/scottish premiership|premiership escocesa/, "Campeonato Escocês", "Europa", "gb-sct"],
  [/fortuna liga|chance liga/, "Campeonato Tcheco", "Europa", "cz"],
  [/eerste divisie/, "Eerste Divisie", "Europa", "nl"],
  [/\bleague one\b/, "EFL League One", "Europa", "gb-eng"],
  [/\bleague two\b/, "EFL League Two", "Europa", "gb-eng"],
  [/liga profesional|liga argentina/, "Campeonato Argentino", "América do Sul", "ar"],
  [/betplay|liga dimayor|categoria primera a/, "Campeonato Colombiano", "América do Sul", "co"],
  [/\bk-?league\b/, "Campeonato Coreano", "Ásia", "kr"],
  [/chinese super league|superliga chinesa/, "Campeonato Chinês", "Ásia", "cn"],
  [/\ba-?league\b/, "Campeonato Australiano", "Ásia", "au"]
];

// "Campeonato <nacionalidade>": adjetivo sem acento → [nome, região, bandeira]
const NAT = {
  holandes: ["Holandês", "Europa", "nl"], belga: ["Belga", "Europa", "be"], turco: ["Turco", "Europa", "tr"],
  escoces: ["Escocês", "Europa", "gb-sct"], grego: ["Grego", "Europa", "gr"], russo: ["Russo", "Europa", "ru"],
  ucraniano: ["Ucraniano", "Europa", "ua"], suico: ["Suíço", "Europa", "ch"], austriaco: ["Austríaco", "Europa", "at"],
  dinamarques: ["Dinamarquês", "Europa", "dk"], sueco: ["Sueco", "Europa", "se"], noruegues: ["Norueguês", "Europa", "no"],
  polones: ["Polonês", "Europa", "pl"], tcheco: ["Tcheco", "Europa", "cz"], croata: ["Croata", "Europa", "hr"],
  servio: ["Sérvio", "Europa", "rs"], romeno: ["Romeno", "Europa", "ro"], hungaro: ["Húngaro", "Europa", "hu"],
  ingles: ["Inglês", "Europa", "gb-eng"], espanhol: ["Espanhol", "Europa", "es"], italiano: ["Italiano", "Europa", "it"],
  alemao: ["Alemão", "Europa", "de"], frances: ["Francês", "Europa", "fr"], portugues: ["Português", "Europa", "pt"],
  mexicano: ["Mexicano", "América do Norte", "mx"], americano: ["Americano", "América do Norte", "us"],
  canadense: ["Canadense", "América do Norte", "ca"],
  argentino: ["Argentino", "América do Sul", "ar"], chileno: ["Chileno", "América do Sul", "cl"],
  uruguaio: ["Uruguaio", "América do Sul", "uy"], colombiano: ["Colombiano", "América do Sul", "co"],
  paraguaio: ["Paraguaio", "América do Sul", "py"], equatoriano: ["Equatoriano", "América do Sul", "ec"],
  peruano: ["Peruano", "América do Sul", "pe"], boliviano: ["Boliviano", "América do Sul", "bo"],
  venezuelano: ["Venezuelano", "América do Sul", "ve"],
  saudita: ["Saudita", "Ásia", "sa"], japones: ["Japonês", "Ásia", "jp"], chines: ["Chinês", "Ásia", "cn"],
  coreano: ["Coreano", "Ásia", "kr"], catari: ["Catari", "Ásia", "qa"], iraniano: ["Iraniano", "Ásia", "ir"],
  indiano: ["Indiano", "Ásia", "in"], australiano: ["Australiano", "Ásia", "au"],
  egipcio: ["Egípcio", "África", "eg"], marroquino: ["Marroquino", "África", "ma"], "sul-africano": ["Sul-Africano", "África", "za"]
};
// "Liga da <país>": país sem acento → adjetivo de NAT
const COUNTRY = {
  australia: "australiano", holanda: "holandes", belgica: "belga", turquia: "turco", escocia: "escoces",
  grecia: "grego", russia: "russo", ucrania: "ucraniano", suica: "suico", austria: "austriaco",
  dinamarca: "dinamarques", suecia: "sueco", noruega: "noruegues", polonia: "polones", mexico: "mexicano",
  japao: "japones", china: "chines", coreia: "coreano", argentina: "argentino", chile: "chileno",
  uruguai: "uruguaio", colombia: "colombiano", paraguai: "paraguaio", equador: "equatoriano", peru: "peruano",
  bolivia: "boliviano", venezuela: "venezuelano", eua: "americano", egito: "egipcio", marrocos: "marroquino",
  portugal: "portugues", espanha: "espanhol", italia: "italiano", alemanha: "alemao", franca: "frances",
  inglaterra: "ingles"
};

const CONCACAF_TEAMS = /\b(eua|estados unidos|usa|mexico|canada|costa rica|panama|jamaica|honduras|haiti|el salvador|guatemala|suriname|trinidad|curacao|nicaragua|cuba|republica dominicana|bermudas|guiana|granada|santa lucia)\b/;

// Copas e taças estaduais que NÃO são o campeonato estadual principal.
const SPECIFIC = [
  [/taca fares lopes|copa fares lopes|fares lopes/, "Taça Fares Lopes"],
  [/taca guanabara/, "Taça Guanabara"], [/taca rio\b/, "Taça Rio"],
  [/copinha|copa sao paulo de futebol junior/, "Copinha"],
  [/copa fpf|copa paulista/, "Copa Paulista"],
  [/taca farroupilha/, "Taça Farroupilha"], [/copa fgf/, "Copa FGF"],
  [/taca minas|taca inconfidencia/, "Taça Minas"], [/taca belo horizonte/, "Taça Belo Horizonte"],
  [/copa espirito santo/, "Copa Espírito Santo"], [/copa rio\b/, "Copa Rio"]
];

// Divisão do estadual: "Série A2", "Série A3", "Série B", "Segunda Divisão", "Módulo II".
function stateDivision(n) {
  const m = n.match(/serie\s*(a2|a3|b|c)\b|\b(a2|a3)\b/);
  if (m) return ` Série ${(m[1] || m[2]).toUpperCase()}`;
  if (/segunda divisao|2a divisao|modulo ii|modulo 2/.test(n)) return " Segunda Divisão";
  if (/terceira divisao|3a divisao/.test(n)) return " Terceira Divisão";
  return "";
}

// Categoria de base: "Sub-20", "U-20", "Under 20".
function ageOf(n) {
  const m = n.match(/\bsub[\s-]?(\d{2})\b/) || n.match(/\bu[\s-]?(\d{2})\b/) || n.match(/\bunder[\s-]?(\d{2})\b/);
  return m ? `Sub-${m[1]}` : /copinha|futebol junior/.test(n) ? "Sub-20" : null;
}

// Campeonatos estaduais do Brasil
const STATES = [
  [/paulist(a|ao)\b/, "Paulista"], [/carioca|cariocao/, "Carioca"], [/\bmineiro\b/, "Mineiro"],
  [/\bgaucho\b|gauchao/, "Gaúcho"], [/paranaense/, "Paranaense"], [/pernambucano/, "Pernambucano"],
  [/baiano/, "Baiano"], [/cearense/, "Cearense"], [/catarinense/, "Catarinense"], [/goiano/, "Goiano"],
  [/capixaba/, "Capixaba"], [/paraense/, "Paraense"], [/maranhense/, "Maranhense"], [/potiguar/, "Potiguar"],
  [/paraibano/, "Paraibano"], [/alagoano/, "Alagoano"], [/sergipano/, "Sergipano"],
  [/sul-?mato-?grossense/, "Sul-Mato-Grossense"], [/\bmato-?grossense/, "Mato-Grossense"],
  [/amazonense/, "Amazonense"], [/piauiense/, "Piauiense"], [/brasiliense|candangao/, "Brasiliense"]
];

// "Liga <adjetivo feminino>" → chave de NAT (ex.: "Liga Checa", "Liga Grega")
const FEM = {
  tcheca: ["tcheco", "Tcheca"], checa: ["tcheco", "Checa"], grega: ["grego", "Grega"], belga: ["belga", "Belga"],
  turca: ["turco", "Turca"], escocesa: ["escoces", "Escocesa"], polonesa: ["polones", "Polonesa"], russa: ["russo", "Russa"],
  ucraniana: ["ucraniano", "Ucraniana"], suica: ["suico", "Suíça"], austriaca: ["austriaco", "Austríaca"],
  dinamarquesa: ["dinamarques", "Dinamarquesa"], sueca: ["sueco", "Sueca"], norueguesa: ["noruegues", "Norueguesa"],
  croata: ["croata", "Croata"], servia: ["servio", "Sérvia"], romena: ["romeno", "Romena"], hungara: ["hungaro", "Húngara"],
  mexicana: ["mexicano", "Mexicana"], argentina: ["argentino", "Argentina"], chilena: ["chileno", "Chilena"],
  uruguaia: ["uruguaio", "Uruguaia"], colombiana: ["colombiano", "Colombiana"], paraguaia: ["paraguaio", "Paraguaia"],
  equatoriana: ["equatoriano", "Equatoriana"], peruana: ["peruano", "Peruana"], boliviana: ["boliviano", "Boliviana"],
  venezuelana: ["venezuelano", "Venezuelana"], japonesa: ["japones", "Japonesa"], chinesa: ["chines", "Chinesa"],
  coreana: ["coreano", "Coreana"], australiana: ["australiano", "Australiana"], egipcia: ["egipcio", "Egípcia"],
  marroquina: ["marroquino", "Marroquina"], americana: ["americano", "Americana"], portuguesa: ["portugues", "Portuguesa"],
  espanhola: ["espanhol", "Espanhola"], italiana: ["italiano", "Italiana"], alema: ["alemao", "Alemã"],
  francesa: ["frances", "Francesa"], inglesa: ["ingles", "Inglesa"]
};

// "Copa <estado>" (Copa Paraná, Copa Ceará…): chave sem acento → nome
const STATE_CUPS = {
  parana: "Paraná", ceara: "Ceará", pernambuco: "Pernambuco", rio: "Rio", "espirito santo": "Espírito Santo",
  "santa catarina": "Santa Catarina", goias: "Goiás", alagoas: "Alagoas", bahia: "Bahia", amazonas: "Amazonas",
  minas: "Minas", para: "Pará", maranhao: "Maranhão", paraiba: "Paraíba", piaui: "Piauí",
  "rio grande do norte": "Rio Grande do Norte", "rio grande do sul": "Rio Grande do Sul", sergipe: "Sergipe",
  "mato grosso do sul": "Mato Grosso do Sul", "mato grosso": "Mato Grosso", tocantins: "Tocantins", acre: "Acre",
  amapa: "Amapá", rondonia: "Rondônia", roraima: "Roraima", "distrito federal": "Distrito Federal",
  "sao paulo": "São Paulo", paulista: "Paulista", fpf: "FPF", fares: "Fares Lopes", "fares lopes": "Fares Lopes"
};

// Nome de campeonato vindo do próprio título (quando nenhuma regra conhece o torneio).
const LEAGUE_WORD = /\b(copa|liga|campeonato|supercopa|taca|torneio|trofeu|superliga|league|cup|divisao|serie [a-d])\b/;
function genericLeague(raw) {
  const parts = raw.replace(/\([^)]*\)/g, " ").split(/\s*\|\s*|\s+[-–—]\s+|:\s+|\s+I\s+/);
  for (const part of parts) {
    const p = part.trim();
    const pn = norm(p);
    if (!LEAGUE_WORD.test(pn)) continue;
    if (/\s(x|×|vs\.?)\s|\d\s?[x×]\s?\d/.test(pn)) continue;       // é um confronto, não o nome do torneio
    if (/ao vivo|com imagens|transmissao|canal |rodada|^\W*final\W*$/.test(pn)) continue;
    const name = p.replace(/\b20\d\d(\/\d\d)?\b/g, "").replace(/\b\d\d\/\d\d\b/g, "").replace(/\s+/g, " ").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "");
    if (name.length >= 4 && name.length <= 40) return name;
  }
  return null;
}

function baseLeague(raw, n) {
  const nl = n.split(/\s*\|\s*|\s+[-–—]\s+|:\s+/).filter((x) => !/\s(x|vs\.?)\s|\d\s?x\s?\d/.test(x)).join(" | "); // título sem os confrontos (nomes de seleções não contam)
  // Liga das Nações: UEFA (Europa) ou CONCACAF (América do Norte). Sem a sigla, decide pelas seleções.
  if (/liga das nacoes|nations league/.test(n)) {
    if (/concacaf/.test(n) || (!/uefa|europa/.test(n) && CONCACAF_TEAMS.test(n))) return L("Liga das Nações da CONCACAF", "América do Norte");
    return L("Liga das Nações da UEFA", "Europa", "eu");
  }
  const ital = /ital|calcio/.test(nl);
  const accentSerie = raw.match(/s\u00e9rie\s*([abcd])\b/i);   // "Série B" (Brasil)
  const plainSerie = raw.match(/\bserie\s*([abc])\b/i);        // "Serie B" (Itália)

  if (/copa do brasil/.test(n)) return L("Copa do Brasil", "Brasil", "br");
  if (/copa do nordeste/.test(n)) return L("Copa do Nordeste", "Brasil", "br");
  if (/copa verde/.test(n)) return L("Copa Verde", "Brasil", "br");
  if (/supercopa do brasil|supercopa rei/.test(n)) return L("Supercopa do Brasil", "Brasil", "br");

  if (!ital && (/brasileir|campeonato brasileiro/.test(n) || accentSerie)) {
    const letter = (accentSerie?.[1] || n.match(/serie\s*([abcd])\b/)?.[1] || "a").toUpperCase();
    return L(`Brasileirão Série ${letter}`, "Brasil", "br");
  }
  if (/coppa italia|copa da italia/.test(n)) return L("Copa da Itália", "Europa", "it");
  if (ital || (plainSerie && !/brasileir/.test(n))) {
    const letter = (n.match(/serie\s*([abc])\b/)?.[1] || "a").toUpperCase();
    if (letter === "A") return L("Campeonato Italiano", "Europa", "it");
    return L(`Série ${letter} Italiana`, "Europa", "it");
  }

  // Torneios específicos de um estado, antes do nome genérico do estadual.
  for (const [re, name] of SPECIFIC) {
    if (re.test(n)) return L(name, "Brasil", "br");
  }
  for (const [re, name] of STATES) {
    if (re.test(n)) return L(`Campeonato ${name}${stateDivision(n)}`, "Brasil", "br");
  }
  for (const [re, name, region, flag] of RULES) {
    if (re.test(n)) return L(name, region, flag ?? null);
  }

  const stateCup = n.match(/copa\s+(?:do |de |da |dos |das )?(rio grande do norte|rio grande do sul|mato grosso do sul|mato grosso|espirito santo|santa catarina|distrito federal|sao paulo|fares lopes|parana|ceara|pernambuco|rio|goias|alagoas|bahia|amazonas|minas|para|maranhao|paraiba|piaui|sergipe|tocantins|acre|amapa|rondonia|roraima|paulista|fpf|fares)\b/)?.[1];
  if (stateCup) return L(`Copa ${STATE_CUPS[stateCup]}`, "Brasil", "br");
  const femAdj = n.match(/(?:liga|campeonato)\s+(?:de\s+)?([a-z]+)/)?.[1];
  if (femAdj && FEM[femAdj]) {
    const [key, disp] = FEM[femAdj];
    return L(`Campeonato ${NAT[key][0]}`, NAT[key][1], NAT[key][2]);
  }
  const adj = n.match(/campeonato\s+([a-z-]+)/)?.[1];
  if (adj && NAT[adj]) return L(`Campeonato ${NAT[adj][0]}`, NAT[adj][1], NAT[adj][2]);
  const country = n.match(/liga d[aeo]s?\s+([a-z]+)/)?.[1];
  if (country && COUNTRY[country]) {
    const [name, region, flag] = NAT[COUNTRY[country]];
    return L(`Campeonato ${name}`, region, flag);
  }
  const g = genericLeague(raw);
  if (g) return L(pretty(g), "Outros");
  return L("Outros campeonatos", "Outros");
}

const FEMININE_NAME = /^(Copa|Taça|Supercopa|Champions League|Liga|Libertadores|Sul-Americana|Recopa|Eurocopa)/;

// Nomes de exibição (iguais aos da arte do EQC). Só valem para o futebol masculino.
const ALIAS = { "Campeonato Inglês": "Premier League", "Campeonato Australiano": "Liga Australiana", "Campeonato Tcheco": "Liga Checa" };

export function leagueOf(title) {
  const n = norm(title);
  let r = baseLeague(title, n);
  if (/feminin|femenin|women|\bnwsl\b|\bwsl\b/.test(n)) {
    if (r.league !== "NWSL") {
      if (r.region === "Outros") r.league = "Futebol feminino";
      else if (r.league.startsWith("Brasileirão")) r.league = "Brasileirão Feminino";
      else r.league += FEMININE_NAME.test(r.league) ? " Feminina" : " Feminino";
    }
    r.region = "Feminino";
  } else if (ALIAS[r.league]) {
    r.league = ALIAS[r.league];
  }
  const age = ageOf(n);
  if (age) {
    r.age = age;
    if (r.league === "Brasileirão Série A" && !/serie\s*a\b/.test(n)) r.league = "Brasileirão";
    if (!norm(r.league).includes(norm(age)) && r.league !== "Copinha") r.league = `${r.league} ${age}`;
  }
  return r;
}

export function roundOf(title) {
  const n = norm(title);
  const m = n.match(/(\d+)\s*[aªº°]?\s*rodada/) || n.match(/rodada\s*(\d+)/);
  if (m) return `${m[1]}ª rodada`;
  if (/ultima rodada/.test(n)) return "Última rodada";
  if (/quartas de final/.test(n)) return "Quartas de final";
  if (/oitavas de final/.test(n)) return "Oitavas de final";
  if (/semifinal|semifinais/.test(n)) return "Semifinal";
  if (/\bfinal\b/.test(n)) return "Final";
  return null;
}

// Siglas que devem continuar em maiúsculas quando o título vem todo em caixa alta.
const ACR = new Set(["PSV", "PSG", "AC", "FC", "SC", "RB", "JC", "CRB", "CSA", "ABC", "EC", "AS", "SS", "SSD",
  "FK", "SK", "BK", "IF", "FF", "VVV", "NEC", "AZ", "CD", "UD", "CF", "RCD", "RC", "SD", "SV", "TSG", "VFB",
  "VFL", "FSV", "RSC", "KRC", "OGC", "LOSC", "LAFC", "NYCFC", "AEK", "PAOK", "KAA", "KV", "FCSB", "LASK", "USA", "UNAM", "MEX"]);
const LOWER = new Set(["de", "da", "do", "dos", "das", "di", "del", "la", "le", "el", "y", "e", "du", "van", "von", "der", "den"]);

function pretty(s) {
  s = s.replace(/\s+/g, " ").trim();
  if (s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  return s.split(" ").map((w, i) => {
    if (ACR.has(w)) return w;
    const lw = w.toLowerCase();
    if (i > 0 && LOWER.has(lw)) return lw;
    return lw
      .replace(/(^|[-.])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
      .replace(/(\p{L}+)(['’])(\p{L})/gu, (m, a, q, b) => a + q + (a.length <= 2 ? b.toUpperCase() : b));
  }).join(" ");
}

// Extrai "Time A x Time B". Se o título tiver mais de um confronto, ou nomes longos demais, devolve null.
export function teamsOf(title) {
  const clean = title.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  const parts = clean.split(/\s*\|\s*|\s+[-–—]\s+|:\s+|\s+I\s+/);
  const found = [];
  for (const p of parts) {
    const m = p.match(/^\s*(.+?)\s+(?:x|×|vs\.?)\s+(.+?)\s*$/i) || p.match(/^\s*(.+?)\s+\d+\s*[x×]\s*\d+\s+(.+?)\s*$/i);
    if (m) found.push([m[1], m[2]]);
  }
  if (found.length !== 1) return { home: null, away: null };
  const [a, b] = found[0]
    .map((t) => t.replace(/\s+(?:e|com)\s+narra[çc][ãa]o.*$/iu, ""))
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  const ok = (t) => t && t.split(/\s+/).length <= 4 && t.length <= 36;
  return ok(a) && ok(b) ? { home: pretty(a), away: pretty(b) } : { home: null, away: null };
}

export function classify(title) {
  return { ...leagueOf(title), round: roundOf(title), ...teamsOf(title) };
}
