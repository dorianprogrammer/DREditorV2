import { useEffect, useRef, useState } from 'react'
import { projectDuration } from '@shared/project'
import { addVoice, formatTime, useEditor } from '../store'

type Phase = 'asking' | 'ready' | 'countdown' | 'recording' | 'saving' | 'error'

export function RecordPanel(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('asking')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [errorKind, setErrorKind] = useState<'denied' | 'nodevice' | 'other'>('other')
  const startAt = useRef(useEditor.getState().time)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audioCtx = useRef<AudioContext | null>(null)
  const hasClips = useEditor((s) => s.project.clips.length > 0)
  const playing = useEditor((s) => s.playing)
  const isWindows = window.api.platform === 'win32'

  const close = (): void => {
    const st = useEditor.getState()
    st.setPlaying(false)
    st.setRecording(false)
  }

  // Ask for the microphone and show a live level meter.
  useEffect(() => {
    let raf = 0
    let alive = true
    ;(async () => {
      try {
        await window.api.askMic()
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        })
        if (!alive) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        const ctx = new AudioContext()
        audioCtx.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(Math.min(1, (peak / 128) * 1.6))
          raf = requestAnimationFrame(tick)
        }
        tick()
        setPhase('ready')
      } catch (err) {
        const name = (err as DOMException)?.name
        setErrorKind(name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'nodevice' : 'other')
        setPhase('error')
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      recorder.current?.state === 'recording' && recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      audioCtx.current?.close()
    }
  }, [])

  // 3-2-1 countdown, then record while the video plays (muted).
  useEffect(() => {
    if (phase !== 'countdown') return
    if (count === 0) {
      beginRecording()
      return
    }
    const id = setTimeout(() => setCount((c) => c - 1), 800)
    return () => clearTimeout(id)
  }, [phase, count])

  useEffect(() => {
    if (phase !== 'recording') return
    const began = performance.now()
    const id = setInterval(() => setElapsed((performance.now() - began) / 1000), 100)
    return () => clearInterval(id)
  }, [phase])

  // Stop automatically when the video reaches the end.
  useEffect(() => {
    if (phase === 'recording' && hasClips && !playing) stopRecording()
  }, [playing])

  function beginRecording(): void {
    const s = stream.current
    if (!s) return
    chunks.current = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const rec = new MediaRecorder(s, { mimeType: mime })
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = save
    recorder.current = rec
    const st = useEditor.getState()
    startAt.current = st.time
    rec.start(250)
    st.setMicLive(true)
    setElapsed(0)
    setPhase('recording')
    if (hasClips) st.setPlaying(true)
  }

  function stopRecording(): void {
    if (recorder.current?.state === 'recording') {
      setPhase('saving')
      useEditor.getState().setMicLive(false)
      useEditor.getState().setPlaying(false)
      recorder.current.stop()
    }
  }

  async function save(): Promise<void> {
    try {
      const blob = new Blob(chunks.current, { type: 'audio/webm' })
      if (blob.size < 2000) {
        useEditor.getState().showToast('La grabación quedó muy corta. ¡Inténtalo otra vez!')
        setPhase('ready')
        return
      }
      const { path, duration } = await window.api.saveVoice(new Uint8Array(await blob.arrayBuffer()))
      close()
      addVoice(path, duration, startAt.current)
      useEditor.getState().showToast('¡Listo! Tu voz se agregó al video 🎤')
    } catch {
      useEditor.getState().showToast('No se pudo guardar la grabación')
      setPhase('ready')
    }
  }

  const total = projectDuration(useEditor.getState().project)

  return (
    <div className="panel record-panel">
      <div className="panel-header tone-voice">
        <span aria-hidden>🎤</span>
        <h3>Grabar tu voz</h3>
      </div>

      {phase === 'asking' && <p className="record-msg">Buscando el micrófono…</p>}

      {phase === 'error' && (
        <div className="record-msg">
          <p>
            <strong>No pudimos usar el micrófono.</strong>
          </p>
          {errorKind === 'nodevice' && <p>Revisa que el micrófono esté conectado.</p>}
          {errorKind !== 'nodevice' && isWindows && (
            <p>
              Pídele a un adulto que abra <em>Configuración › Privacidad y seguridad › Micrófono</em> y active el acceso
              para las aplicaciones de escritorio.
            </p>
          )}
          {errorKind !== 'nodevice' && !isWindows && (
            <p>
              Pídele a un adulto que abra <em>Configuración del Sistema › Privacidad y seguridad › Micrófono</em> y active
              DR Editor.
            </p>
          )}
        </div>
      )}

      {phase === 'ready' && (
        <div className="record-body">
          <p className="record-msg">
            {hasClips
              ? `Tu voz empezará en ${formatTime(startAt.current)}. El video se va a reproducir sin sonido para que hables encima.`
              : 'Habla cuando veas la luz roja.'}
          </p>
          {hasClips && startAt.current >= total - 0.5 && (
            <p className="hint">La línea roja está al final. Muévela al inicio para hablar sobre todo el video.</p>
          )}
          <Meter level={level} />
          <button className="btn record big" onClick={() => {
            setCount(3)
            setPhase('countdown')
          }}>
            <span className="rec-dot" aria-hidden /> Empezar a grabar
          </button>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="countdown" aria-live="assertive">
          {count || '¡Ya!'}
        </div>
      )}

      {phase === 'recording' && (
        <div className="record-body">
          <div className="rec-timer">
            <span className="rec-dot pulsing" aria-hidden /> {formatTime(elapsed)}
          </div>
          <Meter level={level} />
          <button className="btn big" onClick={stopRecording}>
            <span aria-hidden>⏹</span> Terminar
          </button>
        </div>
      )}

      {phase === 'saving' && <p className="record-msg">Guardando tu voz…</p>}

      {(phase === 'ready' || phase === 'error' || phase === 'asking') && (
        <div className="panel-actions">
          <button className="btn ghost" onClick={close}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

function Meter({ level }: { level: number }): React.JSX.Element {
  return (
    <div className="meter" aria-label="Nivel del micrófono">
      <div className="meter-fill" style={{ transform: `scaleX(${level})` }} />
      <span className="meter-label">{level > 0.08 ? '¡Te escucho!' : 'Di algo para probar'}</span>
    </div>
  )
}
