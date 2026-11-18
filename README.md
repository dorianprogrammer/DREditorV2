# DR Editor

A simple video editor for kids (9–10 years old) for making TikTok and YouTube videos. The interface is in Spanish.
Built with Electron for Windows. A macOS build exists for testing.

## What it does

- Import videos and photos (button or drag and drop)
- Two formats, switchable at any time from the top bar: TikTok (vertical 9:16, 1080×1920) and YouTube (horizontal
  16:9, 1920×1080). Vertical and horizontal clips can be mixed; each is fitted over a blurred copy of itself. After
  saving, "Guardar también para …" exports the same edit in the other format
- Timeline: drag to reorder, drag the edges to trim, "Cortar aquí" to split at the playhead
- "Quitar silencios": cuts the quiet parts out of a video clip automatically (FFmpeg `silencedetect`, with the
  threshold set from the clip's average loudness). Pauses under 0.6 s stay, and texts and voices move with the video
- Text over the video: colors, 3 styles (outline, box, shadow), 4 fonts, 4 sizes, drag to move on the video
- Voice-over recording with a 3-2-1 countdown; the video plays muted while recording
- Background music: one song (MP3, M4A, WAV, OGG, FLAC) under the whole video, picked with the button or dropped on
  the window. It loops if it's shorter than the video, fades in and out, can skip the song's intro, and gets quieter
  automatically while a recorded voice plays (`musicGain` in `src/shared/project.ts`, matched by the export)
- Transitions: cut, fade, slide, circle, zoom
- "Zona segura TikTok" guide that shows where TikTok's buttons and caption cover the video
- Undo/redo, autosave, keyboard shortcuts (space, C or Ctrl/⌘+B to cut, Ctrl/⌘+Z, Ctrl+Y, Delete, arrow keys)
- Export to MP4 (H.264 + AAC, 30 fps) in `Videos/DR Editor/`, named `Mi video TikTok …` or `Mi video YouTube …`

## Development

```bash
npm install
npm run dev        # run the app with hot reload
npm run typecheck
```

## Releases

Installers are built by GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)) and published
on the repository's **Releases** page, so another computer only needs to download one file:

| File | What it is |
|---|---|
| `DR-Editor-Setup-<version>.exe` | Windows installer (desktop shortcut, uninstall from Settings) |
| `DR-Editor-<version>-portable.exe` | Windows, no install: runs with a double click, also from a USB stick |
| `DR-Editor-<version>-mac-arm64.dmg` | macOS on Apple Silicon, for testing |

To publish a new version:

```bash
npm version patch          # 0.1.0 → 0.1.1: updates package.json, commits and creates the tag v0.1.1
git push --follow-tags     # pushing the tag starts the build; the release appears in ~10 minutes
```

Use `npm version minor` for new features (0.1.x → 0.2.0). The workflow fails if the tag doesn't match the version in
`package.json`. To try a build without publishing, open **Actions → Release → Run workflow**; the installers are then
attached to that run as artifacts. The text shown on each release (download table, SmartScreen and Gatekeeper help, in
Spanish) is in [.github/release-notes.md](.github/release-notes.md), followed by GitHub's list of changes.

The app is not code-signed. Windows SmartScreen warns the first time it runs ("More info" → "Run anyway"). The Mac
build has an ad-hoc signature, so macOS asks to confirm in System Settings → Privacy & Security → "Open Anyway".

### Building locally

```bash
npm run dist:win   # Windows installer + portable .exe in dist/ (best run on Windows)
npm run dist:mac   # macOS .dmg (Apple Silicon)
```

`dist:win` downloads the Windows FFmpeg binary into `resources/ffmpeg/win32-x64/` and the Windows Electron runtime, so it
needs internet access. On macOS, electron-builder may ask for Wine; the GitHub workflow avoids that by building on a
Windows runner.

## How it works

- `src/shared/project.ts`: project model and timeline math, shared by preview and export.
- `src/renderer/src/engine.ts`: the live preview. It keeps one `<video>` element per clip in sync with the
  timeline clock and draws frames, transitions and text onto a canvas.
- `src/renderer/src/draw.ts`: drawing code. Text is drawn by the same function in the preview and in the
  export (each text becomes a transparent PNG that FFmpeg overlays), so the result matches what the child saw.
- `src/main/ffmpeg.ts`: probing imported files, thumbnails, H.264 preview copies for formats Chromium can't
  play (for example HEVC on Windows without the paid extension), and the export filter graph (`xfade`
  for transitions).
- `src/main/media-protocol.ts`: the `media://` protocol that serves local files to the renderer, with
  Range support so videos can seek.
- Project data is saved in Electron's `userData` folder (`proyecto/proyecto.json` plus recorded voices).
  Imported videos are referenced by path, not copied.
