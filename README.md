# NewsNeutralizer

Point it at a news front page (or an RSS feed). A language model running **on your own machine** then:

1. **Scores the framing** of every headline from left-coded (L2) to right-coded (R2), with confidence.
2. **Rewrites each headline in neutral wire-service (AP) style** and says what it changed and why.
3. **Assesses story selection**: what the page as a whole chooses to cover and emphasize.
4. Shows the originals and rewrites **side by side, with a slider** that wipes from one to the other, plus a 🧘 **sane-brain mode** that shows only the calm versions.

Nothing leaves your Mac except the request for the news page itself. There are no API costs.

## On GitHub (Pages + Actions)

The live site is at **https://samuelling.github.io/NewsNeutralizer/**. It has two parts:

- **Framing board.** GitHub Actions analyzes the sites in `sites.json` twice a day with your API key and commits the results to `docs/data/`. GitHub Pages serves them: one row per site showing how its headlines are worded (●) and which stories it chooses (◇). Click a site for every headline with the side-by-side slider.
- **Paste any URL.** Visitors can analyze any other site with **their own** Claude API key. The key stays in their browser, which calls the Claude API directly. Claude's web-fetch tool fetches the page, because browsers can't fetch other sites themselves. Pasting HTML or a list of headlines works too.

**One-time setup:**
1. **Settings → Secrets and variables → Actions → New repository secret:** `ANTHROPIC_API_KEY` = your key.
2. **Settings → Pages → Build and deployment → Source:** *GitHub Actions*.
3. **Actions → "Analyze sites and deploy Pages" → Run workflow.** Tick *Dry run* first to check that every site can be fetched from GitHub's servers, with no API calls. Then run it again without the tick.

**Cost:** after the first run, only new headlines are analyzed (`data/cache.json` is committed so the cache persists between runs). With Sonnet, 8 sites twice a day is roughly $5–10 a month. Set the repository variable `NN_ANTHROPIC_MODEL=claude-haiku-5-5` to cut that about tenfold. Change the schedule in `.github/workflows/pages.yml` and the site list in `sites.json`. If a front page yields too few headlines (some sites build pages with JavaScript or block GitHub's servers), the site's `feed` is used instead.

## Quick start with the Claude API (fastest)

```bash
git clone https://github.com/samuelling/NewsNeutralizer && cd NewsNeutralizer
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start     # → http://127.0.0.1:8787
```

Setting the key is enough: the app uses the Claude API (Sonnet 5.5 by default) and sends 5 batches at once, so a full front page takes well under a minute. Prompt caching means the long instructions are billed at a fraction of the normal rate after the first batch. Rough cost per 120-headline page: about $0.08 with Sonnet, under $0.01 with Haiku (`NN_ANTHROPIC_MODEL=claude-haiku-5-5`). Repeat visits only pay for new headlines. Get a key at console.anthropic.com. API billing is separate from a Claude.ai subscription.

## Quick start with a local model (free, private, slower)

Requires Apple Silicon with 16 GB+ RAM.

```bash
# 1. Install Ollama (or download the app from ollama.com) and pull the default model (~9 GB)
brew install ollama
ollama serve &            # skip this if the Ollama app is running
ollama pull qwen3:14b

# 2. Run NewsNeutralizer
git clone https://github.com/samuelling/NewsNeutralizer && cd NewsNeutralizer
npm install
npm start                 # → http://127.0.0.1:8787
```

There's no model yet, or you just want to see the UI? Run `npm run mock`. It uses only the built-in word list, with no LLM.

## Choosing a model

| Model | Pull | RAM (4-bit) | Notes |
|---|---|---|---|
| `qwen3:14b` (default) | `ollama pull qwen3:14b` | ~10 GB | Good at structured output; reasoning is switched off for speed |
| `gemma4:12b` | `ollama pull gemma4:12b` | ~9 GB | Newer; worth comparing |
| `phi4:14b` | `ollama pull phi4` | ~10 GB | Strong instruction-following |
| `qwen3.6:27b` | `ollama pull qwen3.6:27b` | ~19 GB | Noticeably better judgment; needs a 32 GB Mac |

```bash
NN_MODEL=gemma4:12b npm start
```

Rough speed on an M-series Mac: a 14B model takes a few seconds per batch of 8 headlines, so a 120-headline front page takes a couple of minutes the first time. Results are cached per headline, so a refresh only processes the stories that are new since last time.

## How it works

```
URL / RSS / pasted HTML
   └─ extract headlines (cheerio; skips nav, footers, ads, tag pages)
        └─ word-list scan (lib/lexicon.js) → hints + independent score
             └─ LLM, batches of 8, JSON-schema output (lib/prompt.js)
                  ├─ lean −2…+2, confidence, category, loaded terms, rewrite, note
                  └─ made-up-fact guard: names/numbers in the rewrite that aren't in the original or URL get flagged ⚠
        └─ one page-level LLM call: topics + story-selection lean
   └─ summary: confidence-weighted framing lean, word-list cross-check, distribution
```

**The meter has three markers, so you can see when they disagree:**
- **Wording (model):** the confidence-weighted average lean of the *political* headlines.
- **Word list:** a fixed, readable list of partisan-coded terms, with no model involved. It's a sanity check on the model.
- **Story selection:** the model's read of what the page chooses to cover. Rewriting headlines can't fix this.

**Same standard for both sides.** The prompt defines lean by *wording only* ("a neutral report of news that's bad for one side is lean 0"). The few-shot examples are mirror images: real right-coded headlines alongside invented left-coded ones in the same styles. The word list covers both directions, plus hype that has no direction ("slams", "SHOCKING"). If you find the model scoring one side harder, add counterexamples to `lib/prompt.js` and bump `PROMPT_VERSION`.

## Evaluate a model

`eval/plainwire-2026-11-09.json` holds 120 Fox News front-page headlines from Nov 9, 2026, with reference rewrites and categories written by Claude (from the original Plain Wire demo).

```bash
npm run eval                        # uses NN_MODEL
NN_MODEL=gemma4:12b npm run eval
npm run eval -- --limit 24          # quick run
```

It prints agreement stats and writes a three-column HTML report (original | reference | your model) to `eval/out/`. For comparison, the word list alone, with no model, gets **60% category agreement and 69% agreement on whether a headline needs any change**. That's the baseline a 14B model should clearly beat.

## Letting other people use it

| Option | How |
|---|---|
| **They run it themselves** | Clone, install Ollama, `npm start`. Free and private, but needs a 16 GB+ Mac. |
| **Share yours through a tunnel** | `HOST=0.0.0.0 NN_TOKEN=some-secret npm start`, then `cloudflared tunnel --url http://localhost:8787`. Share the URL as `https://…trycloudflare.com/?token=some-secret`. Requests queue one at a time, and it only works while your Mac is awake. |
| **Remote GPU box** | Run Ollama on a GPU server and set `OLLAMA_URL=http://that-box:11434`. |
| **Claude API** | `NN_BACKEND=anthropic ANTHROPIC_API_KEY=… npm start`. Best quality, roughly a few cents per front page. |

Always set `NN_TOKEN` before exposing the server. Without it, anyone with the URL can use your model.

## Configuration

| Variable | Default | |
|---|---|---|
| `NN_BACKEND` | `anthropic` if `ANTHROPIC_API_KEY` is set, else `ollama` | `ollama`, `anthropic`, or `mock` |
| `NN_MODEL` | `qwen3:14b` | Ollama model tag |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `NN_ANTHROPIC_MODEL` | `claude-sonnet-5-5` | |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | |
| `NN_TOKEN` | — | Requires `?token=` or an `x-nn-token` header |
| `NN_BATCH` | `8` | Headlines per LLM call |
| `NN_CONCURRENCY` | `5` (API) / `1` (local) | Batches in flight at once |
| `NN_NUM_CTX` | `8192` | Ollama context window |
| `NN_MAX_HEADLINES` | `160` | |
| `NN_CACHE` | `.cache/results.json` | Delete it to start fresh |

## Limits, honestly

- **Scores are estimates.** A 14B model will miss subtle framing and sometimes overcorrect. Treat the meter as a conversation starter, not a verdict.
- **Headlines only.** Rewrites use the headline text and URL; the full article isn't read. The ⚠ guard catches the most common failure, a rewrite that adds names or numbers that weren't there.
- **Some sites block automated requests** or build their pages with JavaScript. Use the site's RSS feed, or paste the page HTML (View Source → Copy).
- **Copyright.** This is fine for personal use and commentary. Republishing a news site's full headline list publicly and continuously is a different matter.

## Tests

`npm test` runs the full pipeline against a fake Ollama server (`test/fake-ollama.js`) that misbehaves on purpose. It drops items, adds a made-up fact, and rejects the `think` option, which checks the fallbacks, the made-up-fact guard and the cache.
