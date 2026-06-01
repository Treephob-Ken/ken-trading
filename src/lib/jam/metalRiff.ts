// Browser-synthesized metal riff — no audio files, no licensing. A palm-muted
// power-chord chug + four-on-the-floor kick and hi-hat, scheduled with the
// classic Web Audio look-ahead pattern (a setInterval picks notes slightly
// ahead of the audio clock so timing stays tight).
//
// Everything is generated from oscillators + a WaveShaper distortion, so this
// ships as pure code. Swap in a real .mp3 later by replacing the <audio> path
// in JamRoomPage — this engine is self-contained and optional.

const BPM = 144

// Distortion curve for the guitar — higher k = more gain/fuzz.
function distortionCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 44100
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  const deg = Math.PI / 180
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

export class MetalJam {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private timer: number | null = null
  private nextNoteTime = 0
  private step = 0
  private volume = 0.5
  private playing = false

  readonly bpm = BPM
  /** Milliseconds per beat — used to sync the cats' headbang speed. */
  get beatMs(): number { return 60000 / this.bpm }
  get isPlaying(): boolean { return this.playing }

  start(): void {
    if (this.playing) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = this.ctx ?? new Ctx()
    this.ctx = ctx
    void ctx.resume()

    const master = ctx.createGain()
    master.gain.value = this.volume
    master.connect(ctx.destination)
    this.master = master

    // One reusable white-noise buffer for the hi-hat.
    if (!this.noiseBuf) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuf = buf
    }

    this.nextNoteTime = ctx.currentTime + 0.1
    this.step = 0
    this.playing = true
    this.timer = window.setInterval(() => this.scheduler(), 25)
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.playing = false
    if (this.master && this.ctx) {
      // Fade out fast to avoid a click, then disconnect.
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.linearRampToValueAtTime(0.0001, now + 0.05)
    }
  }

  // One-shot cymbal crash for a winning-trade reaction. Only audible while the
  // riff is playing (otherwise there's no live AudioContext / user gesture).
  crash(): void {
    if (!this.playing || !this.ctx || !this.master || !this.noiseBuf) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.5, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
    src.connect(hp); hp.connect(g); g.connect(this.master)
    src.start(t); src.stop(t + 0.95)
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02)
    }
  }

  dispose(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
    this.master = null
  }

  private scheduler(): void {
    const ctx = this.ctx
    if (!ctx) return
    const sixteenth = 60 / this.bpm / 4
    while (this.nextNoteTime < ctx.currentTime + 0.1) {
      this.scheduleStep(this.step, this.nextNoteTime)
      this.nextNoteTime += sixteenth
      this.step = (this.step + 1) % 16
    }
  }

  // One 16th-note slot: kick on the beat, hat on off-beats, a guitar chug on
  // every slot. The root note changes each bar for a simple E–E–G–A riff.
  private scheduleStep(step: number, t: number): void {
    if (step % 4 === 0) this.kick(t)
    if (step % 2 === 0) this.hat(t, step % 8 === 4 ? 0.18 : 0.08)
    const roots = [82.41, 82.41, 98.0, 110.0] // E2, E2, G2, A2
    const root = roots[Math.floor(step / 4) % roots.length]
    // Accent the downbeat; palm-mute the rest (shorter, quieter).
    this.chug(root, t, step % 4 === 0 ? 0.5 : 0.28, step % 4 === 0 ? 0.16 : 0.1)
  }

  private chug(freq: number, t: number, gain: number, dur: number): void {
    const ctx = this.ctx!
    const shaper = ctx.createWaveShaper()
    shaper.curve = distortionCurve(60)
    shaper.oversample = '2x'
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    shaper.connect(lp); lp.connect(g); g.connect(this.master!)
    // Power chord = root + fifth (×1.5) + octave, sawtooth for bite.
    for (const mult of [1, 1.5, 2]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq * mult
      osc.connect(shaper)
      osc.start(t)
      osc.stop(t + dur + 0.02)
    }
  }

  private kick(t: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12)
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    osc.connect(g); g.connect(this.master!)
    osc.start(t); osc.stop(t + 0.18)
  }

  private hat(t: number, gain: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    src.connect(hp); hp.connect(g); g.connect(this.master!)
    src.start(t); src.stop(t + 0.06)
  }
}
