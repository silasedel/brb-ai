# brb

A ChatGPT-style chat app powered by **Claude Opus 5** that texts back like a chill teenager.

Full reasoning under the hood, two-line answers on the surface. It only writes an essay
if you actually ask for one.

---

## Setup

Two commands, once:

```bash
npm install
```

```bash
npm run login
```

That second one opens a browser and signs you into your own Claude account
(a Pro/Max subscription or API credits both work). **There is no API key to
find, paste, or keep in a file** — the app borrows the credentials Claude Code
already stores on your machine.

Then, any time you want it:

```bash
npm start
```

Open **http://localhost:4317**.

> Already have `ANTHROPIC_API_KEY` exported? It's picked up automatically and
> you can skip `npm run login`.

---

## What's in it

**Chat**
- Real token-by-token streaming, stop mid-answer
- Multiple conversations, auto-named after the first exchange
- Search across every message you've ever sent
- Pin, rename, delete; grouped by today / yesterday / last 7 days
- Edit any message you sent and re-run from that point
- Regenerate the last reply
- Markdown, tables, and syntax-highlighted code with copy buttons

**The AI**
- Claude Opus 5 with adaptive thinking
- Web search built in — it looks things up when it would otherwise be guessing
- **Detail mode** (the 🧠 button, or `⌘⇧D`): the escape hatch for when you
  genuinely want the long, thorough version

**The app**
- Dark and light themes
- Works on a phone browser
- Keyboard-driven: `⌘K` new chat, `⌘/` search, `⌘B` sidebar, `esc` stop, `?` for the rest

---

## Settings

Click **settings** in the sidebar.

| | |
|---|---|
| **Model** | Opus 5 (default), Sonnet 5, or Haiku 4.5 |
| **Effort** | How hard it thinks before replying. Default `high`. |
| **Web search** | On by default |

Effort is the dial worth knowing about. Higher effort doesn't make replies
*longer* — the persona keeps them short either way — it makes them **right**
more often, at the cost of more of your usage quota. `high` is the sweet spot;
`max` is there for genuinely hard problems.

---

## Where your data lives

`data/conversations/` — one JSON file per chat, on your machine, nowhere else.
Back it up by copying the folder. Delete a file to delete a chat.

Nothing is sent anywhere except your messages going to Anthropic to be answered.

---

## Layout

```
server/
  index.mjs     HTTP + NDJSON streaming
  agent.mjs     Claude Agent SDK wrapper, auth probe
  persona.mjs   the personality
  store.mjs     JSON persistence
web/src/        React UI
data/           your conversations
```

`npm run dev` runs the API and Vite with hot reload (UI on :5317).

---

## If something breaks

**"one-time setup" won't go away** — run `npm run login`, then hit *check again*.
Confirm with `npx claude auth status`.

**"hit ur usage limit"** — you've run through your plan's quota. Wait it out, or
drop to Sonnet/Haiku and lower effort in settings.

**Port 4317 in use** — `PORT=5000 npm start`.
