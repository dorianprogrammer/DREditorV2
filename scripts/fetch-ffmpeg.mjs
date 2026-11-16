// Puts the FFmpeg binary for a target platform in resources/ffmpeg/<platform>-<arch>/
// so electron-builder can bundle it. Usage: node scripts/fetch-ffmpeg.mjs win32 x64
import { createWriteStream, mkdirSync, copyFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const platform = process.argv[2] ?? process.platform
const arch = process.argv[3] ?? process.arch
const outDir = join(root, 'resources', 'ffmpeg', `${platform}-${arch}`)
const outFile = join(outDir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
mkdirSync(outDir, { recursive: true })

if (existsSync(outFile)) {
  console.log(`FFmpeg already present: ${outFile}`)
} else if (platform === process.platform && arch === process.arch) {
  copyFileSync(require('ffmpeg-static'), outFile)
  console.log(`Copied local FFmpeg to ${outFile}`)
} else {
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules/ffmpeg-static/package.json'), 'utf8'))
  const tag = pkg['ffmpeg-static']['binary-release-tag']
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffmpeg-${platform}-${arch}.gz`
  console.log(`Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(outFile))
  console.log(`Saved ${outFile}`)
}
if (platform !== 'win32') chmodSync(outFile, 0o755)
