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

> **Status: early development.** The hotkey, screen capture, and UI pipeline work end to end. Model providers are being wired up next — see the [roadmap](#roadmap).

## What it does

Hit <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> from anywhere in Windows. Argus grabs your screen and opens a small bar, and you either ask it something or hand it the wheel.

**Talk Mode** — ask about what you're looking at.

> *"what does this error mean?"* · *"which of these settings should I turn off?"* · *"summarize this page"*

It answers, and can draw arrows and highlights directly on your screen to point at what it's talking about.

**Agent Mode** — start your request with `agent` and it operates the computer itself.

> *"agent, open chrome and go to github"* · *"agent, close every window except my editor"*

It looks at the screen, decides the next click or keystroke, does it, looks again, and repeats until the task is done.

## Why

Tools like this exist, but they're Mac-only, closed source, and $20–100/month. Your screen contents are about the most personal data you have — the software that reads them should be something you can inspect, self-host, and point at whichever model you trust.

## Privacy

- Screenshots are **held in memory only** — never written to disk, never logged, and dropped the moment your request finishes.
- The screen is captured **only when you press the hotkey**. Nothing runs in the background watching you.
- You bring your own API key. There is no Argus server; your screen goes to the model provider *you* choose, and nowhere else.

## Requirements

- Windows 10/11
- An API key for whichever provider you want to use (Talk Mode supports several; Agent Mode requires Claude — see below)

## Getting started

```bash
git clone https://github.com/<you>/argus.git
cd argus
npm install
npm run dev
```

The app lives in your system tray — press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> to summon it, or click the tray icon. `npm run dev` also prints a local Vite URL; ignore it. Opening it in a browser shows the bar's markup with no access to your screen, because Argus is a desktop app, not a web page.

If another app already owns the hotkey, Argus falls back to the next free combination and tells you which one it took.

To build a Windows installer:

```bash
npm run package   # outputs release/Argus-<version>-Setup.exe
```

## Choosing a model

| Mode | Providers |
| --- | --- |
| **Talk Mode** | Claude or Gemini today; OpenAI and local Ollama models planned |
| **Agent Mode** | **Claude only** |

Configure it from the bar itself — there's no settings window to hunt through:

| Command | What it does |
| --- | --- |
| `/key <api-key>` | Save the key for the current provider |
| `/provider claude` · `/provider gemini` | Switch provider |
| `/model <model-id>` | Change the model |
| `/hotkey <combo>` | Rebind, e.g. `/hotkey Control+Alt+Space` |
| `/help` | List these |

Agent Mode requires Claude because it needs a model that reliably returns precise on-screen coordinates for clicking and typing. Argus won't pretend a weaker model can do this — Agent Mode is simply unavailable unless a Claude key is configured.

## Roadmap

- [x] Global hotkey, tray app, request bar
- [x] In-memory screen capture
- [x] Talk Mode (Claude and Gemini)
- [x] Command palette in the bar
- [x] Agent Mode — autonomous mouse and keyboard control (Gemini)
- [ ] Agent Mode via Claude computer use
- [ ] On-screen annotations — arrows and highlights drawn over your screen
- [ ] Talk Mode for OpenAI + Ollama, settings UI
- [ ] Encrypt stored API keys with Electron `safeStorage`
- [ ] Voice input / dictation
- [ ] Agent Mode — autonomous mouse and keyboard control
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
src/main/       Electron main process — hotkey, capture, windows, tray
src/preload/    Context-isolated bridge exposed to the renderer
src/renderer/   The request bar UI
src/shared/     Types shared across processes
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
