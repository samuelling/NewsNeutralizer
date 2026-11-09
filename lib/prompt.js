// Prompt, few-shot examples and JSON schemas. Bump PROMPT_VERSION whenever the wording changes,
// so cached results from the old prompt aren't reused.
export const PROMPT_VERSION = 'v1';

export const KINDS = ['loaded', 'label', 'gap', 'attrib', 'sens', 'op', 'none'];

export const SYSTEM = `You are a neutral wire-service copy editor (AP style). You receive news headlines, each with its article URL and, sometimes, hints about loaded words. For EACH headline you return:

- political: true if the story concerns politics, government, elections, policy or contested social issues; otherwise false.
- lean: an integer from -2 to +2 describing the FRAMING of the headline's WORDING (not its topic):
    -2 = strongly left-coded wording, -1 = mildly left-coded, 0 = neutral or no partisan direction,
    +1 = mildly right-coded, +2 = strongly right-coded.
  Judge only word choice, labels, emphasis and attribution. A neutral report of news that is bad for one side is lean 0.
  Apply exactly the same standard to both sides: a pejorative label for the left and a pejorative label for the right are mirror images.
  Sensational wording with no partisan direction ("slams", "wild", "shocking") is lean 0 with kind "sens" or "loaded".
- confidence: 0.0-1.0, how sure you are about the lean.
- kind: the MAIN problem fixed, one of:
    "label" (partisan label such as "far-left", "MAGA extremists", "pro-life"/"pro-choice"),
    "loaded" (loaded verb or adjective such as "admits", "claims", "slams", "regime"),
    "gap" (the headline teases or buries the actual news),
    "attrib" (an opinion or claim stated as fact; needs attribution),
    "sens" (hype, ALL CAPS, clickbait, emotional framing),
    "op" (opinion column, commentary or shopping content that needs a label),
    "none" (already neutral).
- loaded_terms: the exact words from the original that you changed or removed (empty if none).
- neutral: the rewritten headline. Rules:
    * Use plain wire verbs ("says", "criticizes", "proposes"). Attribute opinions and disputed claims to whoever made them.
    * Name groups by their own name or by the policy itself ("anti-abortion", "abortion-rights", "bill restricting...", "immigrants in the country illegally").
    * Remove ALL-CAPS emphasis, hype adjectives and emotional framing.
    * For opinion/commentary, begin with "Opinion:" and phrase it as an argument ("X argues..."). For shopping or deals, begin with "Shopping:".
    * NEVER invent facts. Do not add names, numbers, places, dates or outcomes that are not in the headline or its URL. You MAY use facts plainly stated in the URL slug when the headline hides them.
    * If the headline is already neutral, return it nearly unchanged.
    * Keep it about the same length as a normal headline (under 20 words).
- note: one short sentence (under 20 words) saying what you changed and why.

Return JSON only, matching the schema. Include every id you were given, in order.`;

const ex = (id, text, url, hints = '') => ({ id, text, url, hints });

// Balanced few-shot examples: real right-coded headlines (Fox News front page, Nov 9 2026) and
// invented, clearly illustrative left-coded headlines in mirror-image styles, plus neutral ones.
const EXAMPLE_IN = [
  ex(0, "Border Dem poised to wield ICE purse strings rejects socialist 'defund' push", 'https://www.foxnews.com/politics/border-dem-poised-wield-ice-purse-strings-rejects-socialist-defund-push', 'socialist (R)'),
  ex(1, 'MAGA extremists ram through cruel anti-immigrant bill in dead of night', 'https://example-left.com/news/house-republicans-pass-immigration-bill-late-vote', 'MAGA extremists (L)'),
  ex(2, 'JOHN MIZE: Filibuster could be nuked to push radical abortion bill through new Congress', 'https://www.foxnews.com/opinion/john-mize-democrat-victory-means-fight-life-added-importance', 'radical abortion (R); nuked (S)'),
  ex(3, 'JANE ROWE: Republicans have declared war on democracy itself', 'https://example-left.com/opinion/jane-rowe-republicans-democracy', 'war on (S)'),
  ex(4, 'Pro-life pregnancy center expands mission to help patients embrace their God-given gender', 'https://www.foxnews.com/health/pro-life-pregnancy-center-expands-mission-help-patients-embrace-god-given-gender', 'pro-life (R); God-given gender (R)'),
  ex(5, 'Far-right governor signs anti-trans bathroom bill, sparking outrage', 'https://example-left.com/politics/governor-signs-bathroom-bill', 'far-right (L); anti-trans (L); sparking outrage (S)'),
  ex(6, "Biden's open-borders disaster unleashed a migrant crime wave", 'https://example-right.com/politics/border-crossings-crime-data', 'open-borders (R); migrant crime (R)'),
  ex(7, "Trump regime's latest power grab: firing independent watchdogs", 'https://example-left.com/politics/trump-fires-inspectors-general', 'regime (L)'),
  ex(8, 'Trump admits immigration enforcement may have been too \'tough\' in first interview since midterms', 'https://www.foxnews.com/media/trump-admits-immigration-enforcement-may-have-been-too-tough-first-interview-since-midterms', 'admits (S)'),
  ex(9, "Trump responds to Vance's blunt explanation for Republicans' midterm defeat", 'https://www.foxnews.com/media/trump-says-he-doesnt-disagree-vance-iran-war-fueled-gop-losses'),
  ex(10, "FAA's secret weapon slashing fuel costs and shrinking travel times across busy corridors", 'https://www.foxnews.com/politics/exclusive-trumps-faa-touts-new-ai-powered-tool-helping-thousands-passengers-avoid-flight-delays', 'secret weapon (S)'),
  ex(11, "Screams, panic captured after alligator tears off Florida woman's arm", 'https://www.foxnews.com/travel/alligator-attack-florida-mom-sparks-panicked-911-call-arm-gone'),
  ex(12, 'Tesla plans to wind down Cybertruck production after sales slump', 'https://www.foxnews.com/tech/tesla-plans-wind-down-cybertruck-production-after-sales-slump'),
  ex(13, 'Amazon shoppers can\'t stop praising these 17 DeWalt tools', 'https://www.foxnews.com/deals/best-dewalt-tools-amazon'),
];

const o = (id, political, lean, confidence, kind, loaded_terms, neutral, note) => ({ id, political, lean, confidence, kind, loaded_terms, neutral, note });
const EXAMPLE_OUT = { items: [
  o(0, true, 1, 0.7, 'label', ['socialist'], "Democrat expected to lead DHS funding panel says he won't back cutting ICE funding", 'Dropped "socialist" label attached to the defund position.'),
  o(1, true, -2, 0.9, 'label', ['MAGA extremists', 'ram through', 'cruel', 'anti-immigrant', 'in dead of night'], 'House Republicans pass immigration bill in late-night vote', 'Replaced pejorative label and loaded adjectives with what happened.'),
  o(2, true, 2, 0.9, 'op', ['nuked', 'radical abortion bill'], 'Opinion: John Mize warns Democrats could end the filibuster to pass abortion-rights legislation', 'Labeled as opinion; "radical abortion bill" to "abortion-rights legislation".'),
  o(3, true, -2, 0.85, 'op', ['declared war on democracy'], 'Opinion: Jane Rowe argues Republicans are undermining democratic institutions', 'Labeled as opinion; replaced war metaphor with the argument.'),
  o(4, true, 2, 0.85, 'label', ['pro-life', 'God-given gender'], 'Anti-abortion pregnancy center adds counseling encouraging patients to identify with their birth sex', 'AP style "anti-abortion"; described the program instead of using its religious framing.'),
  o(5, true, -2, 0.85, 'label', ['far-right', 'anti-trans', 'sparking outrage'], "Governor signs bill restricting transgender people's bathroom access; critics object", 'Dropped "far-right" label; described what the bill does.'),
  o(6, true, 2, 0.85, 'loaded', ['open-borders disaster', 'unleashed', 'migrant crime wave'], 'Report examines crime data and border crossings under Biden', 'Removed loaded framing; the causal claim needs attribution and evidence.'),
  o(7, true, -2, 0.85, 'loaded', ['regime', 'power grab'], 'Trump administration fires independent watchdogs', '"Regime" and "power grab" replaced with the action.'),
  o(8, true, 0, 0.6, 'loaded', ['admits'], 'Trump says immigration enforcement may have been too tough, in first interview since midterms', '"Admits" implies wrongdoing; wire style is "says".'),
  o(9, true, 0, 0.6, 'gap', ['blunt explanation'], "Trump says he doesn't disagree with Vance that the Iran war fueled GOP losses", 'Headline teased; URL states the substance.'),
  o(10, true, 1, 0.5, 'attrib', ['secret weapon', 'slashing'], 'FAA says new AI tool is cutting fuel costs and travel times', "Agency's own pitch stated as fact; now attributed."),
  o(11, false, 0, 0.9, 'sens', ['Screams, panic'], "Alligator attack severs Florida woman's arm; 911 call released", 'Removed emotional framing.'),
  o(12, false, 0, 0.95, 'none', [], 'Tesla plans to wind down Cybertruck production after sales slump', 'Already neutral.'),
  o(13, false, 0, 0.95, 'op', ["can't stop praising"], 'Shopping: DeWalt tool deals on Amazon', 'Labeled as shopping content.'),
] };

export function userMessage(batch) {
  return 'Headlines:\n' + JSON.stringify(batch.map(b => ({ id: b.id, text: b.text, url: b.url || '', hints: b.hints || '' })), null, 0);
}

export function fewShotMessages() {
  return [
    { role: 'user', content: userMessage(EXAMPLE_IN) },
    { role: 'assistant', content: JSON.stringify(EXAMPLE_OUT) },
  ];
}

export const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          political: { type: 'boolean' },
          lean: { type: 'integer', minimum: -2, maximum: 2 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          kind: { type: 'string', enum: KINDS },
          loaded_terms: { type: 'array', items: { type: 'string' } },
          neutral: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id', 'political', 'lean', 'confidence', 'kind', 'loaded_terms', 'neutral', 'note'],
      },
    },
  },
  required: ['items'],
};

// Page-level pass: what the page chooses to cover. A headline-by-headline rewrite can't see this.
export const PAGE_SYSTEM = `You are a media analyst. You receive the full list of headlines from one news front page.
Assess STORY SELECTION and EMPHASIS, not individual word choice:
- Group the headlines into 4-8 topics and count them.
- For each topic, say whether the selection or emphasis tends to favor a left-leaning or right-leaning narrative (-2..+2), or is neutral (0).
- Give 2-4 short observations about what the page emphasizes, repeats, or omits, compared with what a general-audience front page would usually cover that day. Be concrete and even-handed; note emphasis that cuts against the outlet's apparent lean too.
- selection_lean: overall -2..+2 for story selection only.
Return JSON only.`;

export const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    selection_lean: { type: 'number', minimum: -2, maximum: 2 },
    topics: { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, count: { type: 'integer' }, lean: { type: 'integer', minimum: -2, maximum: 2 } }, required: ['topic', 'count', 'lean'] } },
    observations: { type: 'array', items: { type: 'string' } },
  },
  required: ['selection_lean', 'topics', 'observations'],
};
