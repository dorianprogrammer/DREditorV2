import { useEffect, useRef } from 'react'
import {
  FONT_FAMILIES,
  MIN_CLIP_SECONDS,
  clipLength,
  layoutClips,
  type Clip,
  type FontKey,
  type TextItem,
  type TextStyle,
  type MusicItem,
  type TransitionKind,
  type VoiceItem
} from '@shared/project'
import { contrastOn } from '../draw'
import {
  TEXT_COLORS,
  canSplit,
  deleteSelection,
  formatTime,
  pickMusic,
  removeSilences,
  splitAtPlayhead,
  updateClip,
  updateMusic,
  updateText,
  updateVoice,
  useEditor
} from '../store'

const TRANSITIONS: { kind: TransitionKind; label: string; icon: string }[] = [
  { kind: 'none', label: 'Corte', icon: '⏭' },
  { kind: 'fade', label: 'Desvanecer', icon: '✨' },
  { kind: 'slide', label: 'Deslizar', icon: '👉' },
  { kind: 'circle', label: 'Círculo', icon: '⭕' },
  { kind: 'zoom', label: 'Zoom', icon: '🔍' }
]

const SIZES = [
  { label: 'Chico', size: 70 },
  { label: 'Mediano', size: 110 },
  { label: 'Grande', size: 150 },
  { label: 'Gigante', size: 200 }
]

const STYLES: { style: TextStyle; label: string }[] = [
  { style: 'outline', label: 'Borde' },
  { style: 'box', label: 'Caja' },
  { style: 'shadow', label: 'Sombra' }
]

const FONTS: { font: FontKey; label: string }[] = [
  { font: 'bold', label: 'Gruesa' },
  { font: 'fun', label: 'Divertida' },
  { font: 'impact', label: 'Alta' },
  { font: 'classic', label: 'Elegante' }
]

const secs = (n: number): string => `${n.toFixed(1)} s`

export function Inspector(): React.JSX.Element {
  const selection = useEditor((s) => s.selection)
  const project = useEditor((s) => s.project)

  if (selection?.kind === 'clip') {
    const index = project.clips.findIndex((c) => c.id === selection.id)
    if (index >= 0) return <ClipPanel clip={project.clips[index]} index={index} />
  }
  if (selection?.kind === 'text') {
    const t = project.texts.find((x) => x.id === selection.id)
    if (t) return <TextPanel item={t} />
  }
  if (selection?.kind === 'voice') {
    const v = project.voices.find((x) => x.id === selection.id)
    if (v) return <VoicePanel item={v} />
  }
  if (selection?.kind === 'music' && project.music) return <MusicPanel music={project.music} />
  return (
    <div className="panel panel-empty">
      <h3>¿Qué quieres cambiar?</h3>
      <p>Toca un video, un texto, una voz o la música abajo, en la línea de tiempo, para editarlo aquí.</p>
      <ul className="tips">
        <li>
          <span aria-hidden>👆</span> Arrastra los videos para cambiar el orden.
        </li>
        <li>
          <span aria-hidden>↔️</span> Jala las orillas de un video para recortarlo.
        </li>
        <li>
          <span aria-hidden>✋</span> Mueve los textos con el dedo o el mouse sobre el video.
        </li>
        <li>
          <span aria-hidden>⌨️</span> Barra espaciadora: reproducir o pausar.
        </li>
        <li>
          <span aria-hidden>✂️</span> Tecla C: cortar el video donde está la línea roja.
        </li>
      </ul>
    </div>
  )
}

function PanelHeader({ icon, title, tone }: { icon: string; title: string; tone: string }): React.JSX.Element {
  return (
    <div className={`panel-header tone-${tone}`}>
      <span aria-hidden>{icon}</span>
      <h3>{title}</h3>
    </div>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display: string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">
        {props.label} <strong>{props.display}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

function ClipPanel({ clip, index }: { clip: Clip; index: number }): React.JSX.Element {
  const splittable = useEditor((s) => canSplit(s.project, s.time))
  const placedAt = (): number => layoutClips(useEditor.getState().project.clips)[index]?.at ?? 0
  const showFrame = (t: number): void => {
    const st = useEditor.getState()
    st.setPlaying(false)
    st.seek(t)
  }

  return (
    <div className="panel">
      <PanelHeader icon={clip.kind === 'image' ? '🖼️' : '🎬'} title={clip.name} tone="clip" />

      {clip.kind === 'video' ? (
        <section className="panel-section">
          <h4>Recortar</h4>
          <Slider
            label="Empieza en"
            value={clip.start}
            min={0}
            max={clip.sourceDuration}
            display={secs(clip.start)}
            onChange={(v) => {
              updateClip(clip.id, { start: Math.min(v, clip.end - MIN_CLIP_SECONDS) }, `trim-${clip.id}`)
              showFrame(placedAt())
            }}
          />
          <Slider
            label="Termina en"
            value={clip.end}
            min={0}
            max={clip.sourceDuration}
            display={secs(clip.end)}
            onChange={(v) => {
              const end = Math.max(v, clip.start + MIN_CLIP_SECONDS)
              updateClip(clip.id, { end }, `trim-${clip.id}`)
              showFrame(placedAt() + (end - clip.start) - 0.05)
            }}
          />
          <p className="hint">Dura {secs(clipLength(clip))}</p>
          {clip.hasAudio && (
            <>
              <button className="btn" onClick={() => removeSilences(clip.id)}>
                <span aria-hidden>🤫</span> Quitar silencios
              </button>
              <p className="hint">Corta solito las partes donde no se oye nada.</p>
            </>
          )}
          {clip.hasAudio && (
            <Slider
              label="Volumen del video"
              value={clip.volume}
              min={0}
              max={1}
              step={0.05}
              display={clip.volume === 0 ? 'Silencio' : `${Math.round(clip.volume * 100)}%`}
              onChange={(v) => updateClip(clip.id, { volume: v }, `vol-${clip.id}`)}
            />
          )}
        </section>
      ) : (
        <section className="panel-section">
          <Slider
            label="Cuánto tiempo se ve"
            value={clip.end}
            min={1}
            max={15}
            step={0.5}
            display={secs(clip.end)}
            onChange={(v) => updateClip(clip.id, { end: v }, `dur-${clip.id}`)}
          />
        </section>
      )}

      {index > 0 && (
        <section className="panel-section">
          <h4>Transición al llegar a este video</h4>
          <div className="tile-grid">
            {TRANSITIONS.map((tr) => (
              <button
                key={tr.kind}
                className={`tile ${clip.transition === tr.kind ? 'on' : ''}`}
                onClick={() => {
                  updateClip(clip.id, { transition: tr.kind })
                  showFrame(Math.max(0, placedAt() - 0.4))
                  useEditor.getState().setPlaying(true)
                }}
              >
                <span className="tile-icon" aria-hidden>
                  {tr.icon}
                </span>
                {tr.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="panel-actions">
        <button className="btn" disabled={!splittable} onClick={splitAtPlayhead} title="Tecla C">
          <span aria-hidden>✂️</span> Cortar aquí <kbd>C</kbd>
        </button>
        <button className="btn danger" onClick={deleteSelection}>
          <span aria-hidden>🗑️</span> Borrar
        </button>
      </div>
    </div>
  )
}

function TextPanel({ item }: { item: TextItem }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (item.text === '¡Hola!') ref.current?.select()
  }, [item.id])

  const set = (patch: Partial<TextItem>, key?: string): void => updateText(item.id, patch, key)

  return (
    <div className="panel">
      <PanelHeader icon="🔤" title="Texto" tone="text" />
      <section className="panel-section">
        <textarea
          ref={ref}
          className="text-input"
          value={item.text}
          rows={3}
          placeholder="Escribe aquí…"
          onChange={(e) => set({ text: e.target.value }, `type-${item.id}`)}
        />
      </section>

      <section className="panel-section">
        <h4>Color</h4>
        <div className="swatches">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${item.color === c ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Estilo</h4>
        <div className="tile-grid three">
          {STYLES.map((s) => (
            <button key={s.style} className={`tile ${item.style === s.style ? 'on' : ''}`} onClick={() => set({ style: s.style })}>
              <span className={`style-sample style-${s.style}`} style={styleSample(s.style, item.color)}>
                Aa
              </span>
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Letra</h4>
        <div className="tile-grid two">
          {FONTS.map((f) => (
            <button key={f.font} className={`tile font-tile ${item.font === f.font ? 'on' : ''}`} onClick={() => set({ font: f.font })}>
              <span style={{ fontFamily: FONT_FAMILIES[f.font], fontSize: 22 }}>{f.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Tamaño</h4>
        <div className="segmented">
          {SIZES.map((s) => (
            <button key={s.size} className={item.size === s.size ? 'on' : ''} onClick={() => set({ size: s.size })}>
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <Slider
          label="Cuánto tiempo se ve"
          value={item.duration}
          min={0.5}
          max={15}
          step={0.5}
          display={secs(item.duration)}
          onChange={(v) => set({ duration: v }, `tdur-${item.id}`)}
        />
      </section>

      <div className="panel-actions">
        <button className="btn danger" onClick={deleteSelection}>
          <span aria-hidden>🗑️</span> Borrar texto
        </button>
      </div>
    </div>
  )
}

function styleSample(style: TextStyle, color: string): React.CSSProperties {
  if (style === 'box') return { background: color, color: contrastOn(color) }
  if (style === 'outline') return { color, WebkitTextStroke: '1.5px #111', paintOrder: 'stroke fill' }
  return { color, textShadow: '0 2px 6px rgba(0,0,0,.8)' }
}

function VoicePanel({ item }: { item: VoiceItem }): React.JSX.Element {
  return (
    <div className="panel">
      <PanelHeader icon="🎤" title="Tu voz" tone="voice" />
      <section className="panel-section">
        <p className="hint">
          Dura {secs(item.duration)}. Arrástrala en la línea de tiempo para moverla.
        </p>
        <Slider
          label="Volumen de tu voz"
          value={item.volume}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(item.volume * 100)}%`}
          onChange={(v) => updateVoice(item.id, { volume: v }, `vvol-${item.id}`)}
        />
      </section>
      <div className="panel-actions">
        <button
          className="btn"
          onClick={() => {
            const st = useEditor.getState()
            st.seek(item.start)
            st.setPlaying(true)
          }}
        >
          <span aria-hidden>▶</span> Escuchar
        </button>
        <button className="btn danger" onClick={deleteSelection}>
          <span aria-hidden>🗑️</span> Borrar voz
        </button>
      </div>
    </div>
  )
}

function MusicPanel({ music }: { music: MusicItem }): React.JSX.Element {
  const listen = (): void => {
    const st = useEditor.getState()
    st.seek(0)
    st.setPlaying(true)
  }
  return (
    <div className="panel">
      <PanelHeader icon="🎵" title={music.name} tone="music" />
      <section className="panel-section">
        <Slider
          label="Volumen de la música"
          value={music.volume}
          min={0}
          max={1}
          step={0.05}
          display={music.volume === 0 ? 'Silencio' : `${Math.round(music.volume * 100)}%`}
          onChange={(v) => updateMusic({ volume: v }, 'music-vol')}
        />
        <Slider
          label="Empieza la canción en"
          value={music.offset}
          min={0}
          max={Math.max(0, Math.floor(music.duration) - 1)}
          step={1}
          display={formatTime(music.offset)}
          onChange={(v) => updateMusic({ offset: v }, 'music-offset')}
        />
        <p className="hint">Sirve para saltarte el principio de la canción.</p>
      </section>

      <section className="panel-section">
        <h4>Bajar la música cuando hablo</h4>
        <div className="segmented two">
          <button className={music.duck ? 'on' : ''} onClick={() => updateMusic({ duck: true })}>
            Sí
          </button>
          <button className={!music.duck ? 'on' : ''} onClick={() => updateMusic({ duck: false })}>
            No
          </button>
        </div>
        <p className="hint">Así tu voz se escucha mejor que la canción.</p>
      </section>

      <p className="hint">
        Si usas una canción famosa, TikTok podría quitarle el sonido a tu video. También puedes elegir la música dentro
        de TikTok al subirlo.
      </p>

      <div className="panel-actions">
        <button className="btn" onClick={listen}>
          <span aria-hidden>▶</span> Escuchar
        </button>
        <button className="btn" onClick={() => pickMusic()}>
          <span aria-hidden>🔄</span> Cambiar
        </button>
        <button className="btn danger" onClick={deleteSelection}>
          <span aria-hidden>🗑️</span> Quitar
        </button>
      </div>
    </div>
  )
}
