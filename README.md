# brb

A ChatGPT-style chat app powered by **Claude Opus 5** that texts back like a chill teenager.

Full reasoning under the hood, two-line answers on the surface. It only writes an essay
if you actually ask for one.

### → [Try it in your browser](https://silasedel.github.io/brb-ai/)

No install. It opens with real saved conversations so you can see what it does straight
away. To chat with it yourself you add your own Anthropic API key — it's stored in your
browser and sent only to Anthropic, because that page is static and has no backend to
send it anywhere else.

---

## Two ways to run it

| | Browser version | Local version |
|---|---|---|
| Install | none | `npm install` |
| Sign-in | your own API key | your existing Claude login, no key |
| History | stored in your browser | JSON files on your disk |
| Cost | your API usage | your Claude subscription |

The local version is the nicer one if you already use Claude Code — no key, and it runs
on your subscription.

---

## Setup (local version)

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

## It remembers you

The thing that makes it feel less like a demo and more like an assistant.

As you talk, a cheap background model pulls out durable facts about you — your
name, what you're building, that you're allergic to peanuts — and carries them
into **every future conversation**. Not the chat history; the facts.

```
chat 1   you: im silas, building a chat app in react. allergic to peanuts btw
         brb: hey silas. noted on the peanuts

chat 2   you: whats my name
   (new) brb: silas

         you: suggest a quick snack for me
         brb: apple + sunflower seed butter. quick, no peanuts anywhere near it
```

Nobody asked it to avoid peanuts in that last one.

Click **memory** in the sidebar to see everything it knows, edit any of it, add
your own ("they prefer typescript"), or delete the lot. Memory you can't
inspect or correct is a liability, so all of it is visible and yours.

---

## It texts like a person, not a chatbot

Every other assistant answers in one block of prose. This one doesn't.

**It sends several short texts.** A reply arrives as separate bubbles, the way
someone actually types:

```
you   yo is rust worth learning

brb   yea if ur doing cli tools it's genuinely the move
brb   fast binaries, no runtime, clap + ratatui are great
brb   it'll fight u for like 2 weeks tho, borrow checker is rough coming from ts
```

Code, lists and tables stay in one piece — only conversational replies get split.

**It reacts.** Sometimes a message deserves a tapback more than a sentence, so
it drops one on yours, iMessage style:

```
you   i deployed to prod on a friday and took down the whole site lol
                                                              😭
brb   rip
brb   how long was it down
```

Roughly one message in ten. A reaction on a boring message is worse than none.

**It matches your energy.** `whats 2+2` gets `4`. One character. Write it a
paragraph and it gives you substance back.

**You can cut it off.** Start typing while it's still replying and hit enter —
it stops mid-sentence and deals with what you just said, like interrupting
someone. No waiting for it to finish a thought you no longer care about.

---

## It texts you first

Every chatbot waits for you to speak. This one doesn't.

On a schedule, it looks at what it knows about you and what you were last
building, **searches the web**, and decides whether it has anything genuinely
worth saying. Usually it decides no — that restraint is the feature. A bot that
pings you daily with "just checking in!" gets muted in a week.

When it does have something, it lands in the conversation with an unread dot:

> **brb texted you first**
> react 19.3 dropped sept 9 — view transitions are stable now, which is basically
> free animations for ur chat msg list entering/leaving
>
> also fragment refs landed, handy for scroll-to-bottom without wrapper divs

That's not a canned notification. It knew a React chat app was being built,
went and found a real release, and picked out the two things in it that matter
for *that* — scroll-to-bottom is a chat-app problem.

Don't want it? One switch in settings. It never fires between 11pm and 8am.

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
- **Detail mode** (`⌘⇧D`): the escape hatch for when you genuinely want the
  long, thorough version
- **Multi-text replies, tapback reactions, energy matching, interruptible**
- **Persistent memory** across every conversation, fully editable
- **Proactive check-ins** — it starts conversations when it has a reason to

**The app**
- Warm paper-and-ink design, light and dark
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

`data/conversations/` — one JSON file per chat, plus `memory.json`, on your
machine and nowhere else. Back it up by copying the folder. Delete a file to
delete a chat. The browser version keeps the equivalent in localStorage.

Nothing is sent anywhere except your messages going to Anthropic to be answered.

---

## Layout

```
server/
  index.mjs     HTTP + NDJSON streaming
  agent.mjs     Claude Agent SDK wrapper, auth probe
  persona.mjs   the personality
  memory.mjs    fact extraction + recall
  checkin.mjs   deciding whether to text you first
  store.mjs     JSON persistence
web/src/
  backend/      one interface, two implementations (local server / browser)
  components/   the UI
data/           your conversations and memory
docs/           the built static site (GitHub Pages)
```

`npm run dev` runs the API and Vite with hot reload (UI on :5317).

---

## If something breaks

**"one-time setup" won't go away** — run `npm run login`, then hit *check again*.
Confirm with `npx claude auth status`.

**"hit ur usage limit"** — you've run through your plan's quota. Wait it out, or
drop to Sonnet/Haiku and lower effort in settings.

**Port 4317 in use** — `PORT=5000 npm start`.
