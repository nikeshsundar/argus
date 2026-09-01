<div align="center">

<img src="resources/icon.png" width="96" alt="Argus" />

# Argus

**A screen-aware AI assistant for Windows.**
Press a hotkey anywhere, ask about whatever is on your screen — or tell it to take over and do the work.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Status](https://img.shields.io/badge/status-early%20development-orange)

</div>

---

> **Status: early development.** Talk Mode and Agent Mode both work. Expect rough edges — see the [roadmap](#roadmap).

## What it does

Hit <kbd>Alt</kbd>+<kbd>`</kbd> from anywhere in Windows. Argus grabs your screen and opens a small bar, and you either ask it something or hand it the wheel.

**Talk Mode** — ask about what you're looking at, then keep asking.

> *"who is this creator?"* → *"how many subscribers?"* → *"what's their most popular video?"*

Follow-ups understand what came before, so you don't have to re-explain yourself.

**Agent Mode** — start your request with `agent` and it operates the computer itself.

> *"agent, open notepad and type hello"* · *"agent, open chrome and go to github"*

It looks at the screen, decides the next click or keystroke, does it, looks again, and repeats until the task is done.

## Why

Tools like this exist, but they're Mac-only, closed source, and $20–100/month. Your screen contents are about the most personal data you have — the software that reads them should be something you can inspect, self-host, and point at whichever model you trust.

## Privacy

- Screenshots are **held in memory only** — never written to disk, never logged, and dropped when you dismiss the bar.
- The screen is captured **only when you press the hotkey**. Nothing runs in the background watching you.
- You bring your own API key. There is no Argus server; your screen goes to the model provider *you* choose, and nowhere else.

## Requirements

- Windows 10/11
- An API key from Google (Gemini) or Anthropic (Claude)

## Getting started

```bash
git clone https://github.com/<you>/argus.git
cd argus
npm install
npm run dev
```

The app lives in your system tray — press <kbd>Alt</kbd>+<kbd>`</kbd> to summon it, or click the tray icon. Paste your API key into the bar with `/key <your-key>` and you're set; Argus recognises the key's format and selects the matching provider for you.

`npm run dev` also prints a local Vite URL. Ignore it — opening it in a browser shows the bar's markup with no access to your screen, because Argus is a desktop app, not a web page.

To build a Windows installer:

```bash
npm run package   # outputs release/Argus-<version>-Setup.exe
```

## Using the bar

| Key | Does |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>`</kbd> | Open (or close) the bar |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move through the options |
| <kbd>Enter</kbd> | Ask, or run the highlighted option |
| <kbd>Esc</kbd> | Clear what you typed |
| <kbd>Esc</kbd> <kbd>Esc</kbd> | Close the bar |

The bar stays put when you click into another window, so an answer is still there while you work. Drag it anywhere; it reopens where you left it.

## Choosing a model

| Mode | Providers |
| --- | --- |
| **Talk Mode** | Claude or Gemini; OpenAI and local Ollama planned |
| **Agent Mode** | Gemini; Claude computer use planned |

Configure it from the bar itself — there's no settings window to hunt through:

| Command | What it does |
| --- | --- |
| `/key <api-key>` | Save a key, and switch to whichever provider it belongs to |
| `/provider claude` · `/provider gemini` | Switch provider |
| `/model <model-id>` | Change the model |
| `/hotkey <combo>` | Rebind, e.g. `/hotkey Control+Alt+Space` |
| `/help` | List these |

## About the hotkey

Windows refuses to hand any <kbd>Win</kbd>+<kbd>key</kbd> combination to an ordinary application, so Argus installs a low-level keyboard hook — the same approach PowerToys uses — whenever Electron can't claim a shortcut.

A hook can *see* a keystroke but cannot stop other apps receiving it. That's why <kbd>Win</kbd>+<kbd>`</kbd> is not the default: Windows Terminal already binds it to quake mode, so it would open a terminal every time. <kbd>Alt</kbd>+<kbd>`</kbd> is free on a stock Windows install. If something on your machine claims it, rebind with `/hotkey`.

## Roadmap

- [x] Global hotkey (including combinations Windows won't hand over), tray app, request bar
- [x] In-memory screen capture
- [x] Talk Mode with follow-up questions (Claude and Gemini)
- [x] Command palette in the bar
- [x] Agent Mode — autonomous mouse and keyboard control (Gemini)
- [ ] Agent Mode via Claude computer use
- [ ] On-screen annotations — arrows and highlights drawn over your screen
- [ ] Talk Mode for OpenAI + Ollama, settings UI
- [ ] Encrypt stored API keys with Electron `safeStorage`
- [ ] Voice input / dictation
- [ ] Prebuilt installer in GitHub Releases

## Development

```bash
npm run dev        # run with hot reload
npm run typecheck  # type-check main, preload, and renderer
npm test           # unit tests
npm run build      # bundle to out/
npm run icon       # regenerate resources/icon.png
```

**Project layout**

```
src/main/       Electron main process — hotkey, capture, agent loop, windows, tray
src/preload/    Context-isolated bridge exposed to the renderer
src/renderer/   The request bar and the agent overlay
src/shared/     Types and pure logic shared across processes
```

## Safety

Agent Mode controls your real mouse and keyboard. Four things keep that honest:

- A pulsing amber frame covers the screen the whole time it has control — it can never operate your machine silently.
- <kbd>Esc</kbd> stops it instantly, from anywhere, whether or not Argus has focus.
- Every task is capped at 14 actions, so a confused model can't grind away indefinitely.
- It works one action at a time, re-reading the screen after each, rather than firing off a blind sequence.

Don't point it at anything you can't afford to have clicked.

## Contributing

Issues and PRs welcome. Good first areas: additional providers, annotation rendering, and the settings UI.

## License

[MIT](LICENSE)
