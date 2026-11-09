// A deterministic, transparent "loaded language" lexicon.
// It does two jobs:
//   1. It gives the LLM hints, so a small model doesn't miss obvious terms.
//   2. It provides an independent cross-check score that needs no model at all.
// dir: 'R' = term is characteristic of right-leaning framing, 'L' = left-leaning framing,
//      'S' = sensational / hype with no partisan direction.
// Context matters: "socialist" is neutral when describing the Democratic Socialists of America,
// so these are hints, not verdicts. The LLM makes the final call.

const R = 'R', L = 'L', S = 'S';
const E = [
  // ── right-coded framing ─────────────────────────────────────────────
  [R, 'radical left|far[- ]left|hard[- ]left|leftists?|lefties|libs\\b|libtards?', 'pejorative label for the left'],
  [R, 'socialists?(?! (?:party|alternative))|marxists?|communists?', 'socialist/marxist used as a label (accurate for self-described DSA members)'],
  [R, 'woke(?:ism|ness)?|wokeness', 'pejorative "woke"'],
  [R, 'illegal aliens?|illegals\\b', 'AP style: "immigrants in the country illegally"'],
  [R, 'pro[- ]life', 'AP style: "anti-abortion"'],
  [R, 'radical abortion|abortion extremists?|abortion on demand|late[- ]term abortion', 'loaded abortion framing'],
  [R, 'open[- ]borders?', 'loaded immigration framing'],
  [R, 'gender ideology|god[- ]given gender|transgender ideology|groomers?', 'loaded gender framing'],
  [R, 'democrat (?:party|lawmakers?|senators?|governors?|leaders?|cities|states)', '"Democrat" as an adjective (vs. "Democratic") signals partisan style'],
  [R, 'biden regime|harris regime|deep state|weaponi[sz]ed doj', 'loaded framing'],
  [R, 'death tax|government takeover|nanny state', 'loaded policy framing'],
  [R, 'dei hires?|anti-white', 'loaded framing'],
  [R, 'defund(?:ing)? (?:the )?(?:police|ice)', 'slogan framing (can be accurate when quoting a campaign)'],
  [R, 'trump derangement|tds\\b', 'pejorative'],
  [R, 'migrant crime|border crisis|invasion', 'loaded immigration framing (contextual)'],

  // ── left-coded framing ──────────────────────────────────────────────
  [L, 'far[- ]right|alt[- ]right|ultra[- ]right|right[- ]wing extremists?', 'label for the right (accurate in some contexts)'],
  [L, 'maga (?:extremists?|republicans|cult|mob)|ultra[- ]maga|maga\\b(?= (?:crowd|base|loyalists?))', 'pejorative MAGA framing'],
  [L, 'anti[- ]trans|anti[- ]lgbtq\\+?|don\'?t say gay', 'AP prefers describing what a measure does'],
  [L, 'pro[- ]choice|forced[- ]birth|anti[- ]choice|reproductive freedom', 'AP style: "abortion-rights" / "anti-abortion"'],
  [L, 'undocumented (?:immigrants?|people|workers?)', 'AP style: "immigrants in the country illegally"'],
  [L, 'climate deniers?|climate denial|climate criminals?', 'loaded label'],
  [L, 'fascis(?:t|m)|authoritarian(?:ism)?|dictator(?:ship)?|autocra(?:t|cy)|regime', 'loaded label (contextual; "regime" applied to the US government)'],
  [L, 'voter suppression|jim crow 2\\.0', 'loaded voting framing (contextual)'],
  [L, 'tax cuts? for (?:the )?(?:rich|wealthy|billionaires)|corporate greed|billionaire[- ]backed', 'loaded economic framing'],
  [L, 'gun violence epidemic|weapons of war|assault weapons', 'contested gun terminology'],
  [L, 'racists?|bigot(?:s|ed|ry)|xenophob(?:ic|ia)|white supremac(?:y|ist)', 'characterization; needs attribution'],
  [L, 'christian nationalis(?:t|m)|theocra(?:cy|tic)', 'loaded label (contextual)'],
  [L, 'trumpist|trumpian|felon trump|insurrectionists?', 'loaded framing'],
  [L, 'grifters?|conspiracy theorists?', 'loaded characterization'],

  // ── sensational, no direction ───────────────────────────────────────
  [S, 'slams?|slammed|blasts?|blasted|rips?|ripped|torches?|torched|eviscerates?|destroys?|demolishes|annihilates?|shreds?', 'combative verb; wire style: "criticizes" / "says"'],
  [S, 'fires? back|hits? back|claps? back|unloads?|lashes out|goes off|melts? down|meltdown|tirade|rant', 'combative framing'],
  [S, 'admits?|admitted|concedes?', 'implies guilt; wire style: "says"'],
  [S, 'claims?(?= (?:that|he|she|they|it|\\w+ (?:is|was|are|were|has|had|will)))|claimed', 'signals doubt; wire style: "says"'],
  [S, 'mocks?|sneers?|smirks?|scoffs?', 'tone verb'],
  [S, 'bombshell|shocking|stunning|chilling|explosive|jaw[- ]dropping|wild|insane|brutal|horrifying|disgusting|sick', 'hype adjective'],
  [S, 'sparks? (?:outrage|fury|backlash|firestorm)|outrage|fury|furious|firestorm|erupts?|explodes?', 'emotion framing'],
  [S, 'showdown|war on|crusade|nuked?|nuclear option', 'conflict metaphor'],
  [S, 'secret weapon|you won\'?t believe|here\'?s why|what happens next|the (?:real|shocking) reason', 'clickbait construction'],
  [S, 'disgraced|embattled|scandal[- ]plagued', 'pre-judging label'],
];

const COMPILED = E.map(([dir, src, why]) => ({ dir, why, re: new RegExp(`(?<![\\w-])(?:${src})(?![\\w-])`, 'gi') }));
const CAPS = /\b[A-Z]{4,}\b/g;
const CAPS_OK = new Set(['NASA', 'NATO', 'FEMA', 'NCAA', 'NASCAR', 'OPEC', 'ESPN', 'UNICEF', 'COVID', 'HIPAA', 'TPUSA', 'USVETS', 'ICE', 'IRS', 'DHS', 'FBI', 'CIA', 'NFL', 'NBA', 'MLB', 'NHL', 'UFC', 'WNBA', 'AARP', 'NAACP', 'ACLU', 'NPR', 'CNN', 'MSNBC', 'NYPD', 'LAPD', 'OPINION', 'WATCH', 'EXCLUSIVE', 'LIVE', 'UPDATE', 'BREAKING']);

/** Find loaded terms in one headline. Returns { hits: [{term, dir, why}], caps: [...], score }. */
export function scanHeadline(text) {
  const hits = [];
  // Skip an all-caps byline prefix such as "RILEY GAINES:" or "WATCH:".
  const body = text.replace(/^[A-Z][A-Z .'’-]+:\s*/, '');
  for (const { dir, why, re } of COMPILED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body))) hits.push({ term: m[0], dir, why });
  }
  const caps = (body.match(CAPS) || []).filter(w => !CAPS_OK.has(w));
  for (const c of caps) hits.push({ term: c, dir: S, why: 'ALL-CAPS emphasis' });
  const score = hits.reduce((s, h) => s + (h.dir === R ? 1 : h.dir === L ? -1 : 0), 0);
  return { hits, score };
}

/** Byline prefixes that usually mark opinion/commentary on news front pages. */
export function looksLikeOpinion(text, url = '') {
  return /\/opinion\//i.test(url) || /^[A-Z][A-Z .'’-]{3,}:\s/.test(text) && !/^(WATCH|LIVE|EXCLUSIVE|BREAKING|UPDATE|JOIN THE CONVERSATION|EXPLORE THE DATA)\b/.test(text);
}
export function looksLikeShopping(url = '') { return /\/(deals|shopping|coupons|best-|reviews\/product)/i.test(url); }
