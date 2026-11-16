# DR Editor

A simple video editor for kids (9–10 years old) for making TikTok videos. The interface is in Spanish.
Built with Electron for Windows. A macOS build exists for testing.

## What it does

- Import videos and photos (button or drag and drop)
- Vertical 9:16 preview (1080×1920); horizontal clips are fitted over a blurred copy of themselves
- Timeline: drag to reorder, drag the edges to trim, "Cortar aquí" to split at the playhead
- "Quitar silencios": cuts the quiet parts out of a video clip automatically (FFmpeg `silencedetect`, with the
  threshold set from the clip's average loudness). Pauses under 0.6 s stay, and texts and voices move with the video
- Text over the video: colors, 3 styles (outline, box, shadow), 4 fonts, 4 sizes, drag to move on the video
- Voice-over recording with a 3-2-1 countdown; the video plays muted while recording
- Transitions: cut, fade, slide, circle, zoom
- "Zona segura TikTok" guide that shows where TikTok's buttons and caption cover the video
- Undo/redo, autosave, keyboard shortcuts (space, C or Ctrl/⌘+B to cut, Ctrl/⌘+Z, Ctrl+Y, Delete, arrow keys)
- Export to MP4 (H.264 + AAC, 1080×1920, 30 fps) in `Videos/DR Editor/`

## Development

```bash
npm install
npm run dev        # run the app with hot reload
npm run typecheck
```

## Building installers

```bash
npm run dist:win   # Windows installer → dist/DR Editor Setup <version>.exe
npm run dist:mac   # macOS .dmg (Apple Silicon), for testing
```

`dist:win` downloads the Windows FFmpeg binary into `resources/ffmpeg/win32-x64/` and the Windows Electron
runtime, so it needs internet access. If electron-builder asks for Wine on macOS, build on a Windows PC
(or a Windows CI runner) instead.

The app is not code-signed, so Windows SmartScreen shows a warning the first time it runs
("More info" → "Run anyway").

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
