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

Hit <kbd>Ctrl</kbd>+<kbd>Space</kbd> from anywhere in Windows. Argus grabs your screen and opens a small bar, and you either ask it something or hand it the wheel.

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

The app lives in your system tray. Press <kbd>Ctrl</kbd>+<kbd>Space</kbd> to summon it.

To build a Windows installer:

```bash
npm run package   # outputs release/Argus-<version>-Setup.exe
```

## Choosing a model

| Mode | Providers |
| --- | --- |
| **Talk Mode** | Claude, OpenAI, or a local model via Ollama — anything with vision |
| **Agent Mode** | **Claude only** |

Agent Mode requires Claude because it needs a model that reliably returns precise on-screen coordinates for clicking and typing. Argus won't pretend a weaker model can do this — Agent Mode is simply unavailable unless a Claude key is configured.

## Roadmap

- [x] Global hotkey, tray app, request bar
- [x] In-memory screen capture
- [ ] Talk Mode (Claude)
- [ ] On-screen annotations — arrows and highlights drawn over your screen
- [ ] Talk Mode for OpenAI + Ollama, settings UI
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

Agent Mode controls your real mouse and keyboard. It always shows a visible on-screen indicator while active, stops immediately on <kbd>Esc</kbd>, and is capped at a maximum number of steps per task. Don't run it against anything you can't afford to have clicked.

## Contributing

Issues and PRs welcome. Good first areas: additional providers, annotation rendering, and the settings UI.

## License

[MIT](LICENSE)
