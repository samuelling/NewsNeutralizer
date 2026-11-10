# NewsNeutralizer

**https://samuelling.github.io/NewsNeutralizer/**

Paste a news site's URL. Claude reads every headline on the front page and then:

- scores how the page's political headlines are **worded**, from left-coded to right-coded;
- checks **story selection**, meaning what the page chooses to cover;
- **rewrites every headline** in plain, neutral wire-service style, noting what changed and why.

Compare the original and neutral versions side by side with a slider, or switch to 🧘 **calm mode** and read only the neutral headlines.

## How it runs

It's a static page on GitHub Pages, with no server and nothing scheduled. Each analysis happens only when you click **Analyze**, using your own Claude API key ([get one here](https://console.anthropic.com/settings/keys)).

- The key stays in your browser (for the session, or on the device if you tick "Remember") and is sent only to `api.anthropic.com`.
- Claude's web-fetch tool fetches the page, because browsers can't fetch other news sites themselves. If a site blocks it, open **More options** and paste the page source or a list of headlines.
- Rough cost per front page: ~8¢ with Sonnet 5.5, under 1¢ with Haiku 5.5. Re-checking a site in the same browser only pays for new headlines.

## Files

| | |
|---|---|
| `docs/index.html` | The page: layout, styles and UI |
| `docs/client.js` | Talks to the Claude API: fetches the page, rewrites in parallel batches, caches results in the browser |
| `docs/lib/prompt.js` | Instructions and balanced left/right examples for Claude |
| `docs/lib/lexicon.js` | Word list of partisan-coded and hype terms, an independent check that involves no AI |
| `docs/lib/score.js` | Scoring and the check that flags names or numbers a rewrite added |

**Publishing:** Settings → Pages → Source: **GitHub Actions**. Every push that changes `docs/` redeploys the site.

## Limits

Scores are a language model's estimates from headline wording, not verdicts, and can be wrong in either direction. Rewrites use only the headline and its link, so they can't add context the article provides.
