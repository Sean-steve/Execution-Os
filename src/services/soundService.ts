/**
 * Web Audio API synthesizer for ambient focus sounds and chimes
 */

class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private currentNoiseNode: AudioNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlayingAmbient = false;
  private currentSoundType: 'NONE' | 'BROWN_NOISE' | 'MEDITATION_DRONE' | 'RAIN_FOCUS' = 'NONE';

  private initContext() {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtxClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playChime(type: 'success' | 'bell' | 'start' | 'tick' | 'penalty' | 'warning' = 'bell') {
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      if (type === 'penalty' || type === 'warning') {
        // Stern descending minor tone for missed time / discipline penalty
        [440, 370, 311.13, 220].forEach((freq, idx) => {
          if (!this.ctx) return;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(freq, now + idx * 0.1);
          g.gain.setValueAtTime(0.16, now + idx * 0.1);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
          o.connect(g);
          g.connect(this.ctx.destination);
          o.start(now + idx * 0.1);
          o.stop(now + idx * 0.1 + 0.4);
        });
      } else if (type === 'bell') {
        // Tibetan / Zen singing bowl harmonic chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(432, now);
        osc.frequency.exponentialRampToValueAtTime(216, now + 2.5);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        osc.start(now);
        osc.stop(now + 2.5);

        // Secondary harmonic
        const harmonic = this.ctx.createOscillator();
        const harmGain = this.ctx.createGain();
        harmonic.type = 'sine';
        harmonic.frequency.setValueAtTime(864, now);
        harmonic.connect(harmGain);
        harmGain.connect(this.ctx.destination);
        harmGain.gain.setValueAtTime(0.12, now);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        harmonic.start(now);
        harmonic.stop(now + 1.8);
      } else if (type === 'success') {
        // Major chord arpeggio
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
          if (!this.ctx) return;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.type = 'triangle';
          o.frequency.setValueAtTime(freq, now + idx * 0.08);
          g.gain.setValueAtTime(0.18, now + idx * 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);
          o.connect(g);
          g.connect(this.ctx.destination);
          o.start(now + idx * 0.08);
          o.stop(now + idx * 0.08 + 0.5);
        });
      } else if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.25);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else {
        // Tick
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.04);
      }
    } catch {
      // Audio context might be restricted before user gesture
    }
  }

  public startAmbient(type: 'BROWN_NOISE' | 'MEDITATION_DRONE' | 'RAIN_FOCUS') {
    this.stopAmbient();
    try {
      this.initContext();
      if (!this.ctx) return;

      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);

      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);

      if (type === 'BROWN_NOISE') {
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = data[i];
          data[i] *= 3.5; // boost
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, this.ctx.currentTime);

        noise.connect(filter);
        filter.connect(this.gainNode);
        this.gainNode.gain.setValueAtTime(0.2, this.ctx.currentTime);
        noise.start();
        this.currentNoiseNode = noise;
      } else if (type === 'MEDITATION_DRONE') {
        // 432 Hz + 108 Hz calm harmonic drone
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(108, this.ctx.currentTime);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(216, this.ctx.currentTime);

        osc1.connect(this.gainNode);
        osc2.connect(this.gainNode);
        this.gainNode.gain.setValueAtTime(0.08, this.ctx.currentTime);
        osc1.start();
        osc2.start();
        this.currentNoiseNode = osc1;
      } else if (type === 'RAIN_FOCUS') {
        // Pink-filtered rain texture
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
          b6 = white * 0.115926;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, this.ctx.currentTime);
        filter.Q.setValueAtTime(1.2, this.ctx.currentTime);

        noise.connect(filter);
        filter.connect(this.gainNode);
        this.gainNode.gain.setValueAtTime(0.18, this.ctx.currentTime);
        noise.start();
        this.currentNoiseNode = noise;
      }

      this.isPlayingAmbient = true;
      this.currentSoundType = type;
    } catch {
      // Audio context error
    }
  }

  public stopAmbient() {
    if (this.currentNoiseNode) {
      try {
        if ('stop' in this.currentNoiseNode && typeof (this.currentNoiseNode as AudioScheduledSourceNode).stop === 'function') {
          (this.currentNoiseNode as AudioScheduledSourceNode).stop();
        }
        this.currentNoiseNode.disconnect();
      } catch {
        // ignore
      }
      this.currentNoiseNode = null;
    }
    this.isPlayingAmbient = false;
    this.currentSoundType = 'NONE';
  }

  public isAmbientActive(): boolean {
    return this.isPlayingAmbient;
  }

  public getSoundType(): string {
    return this.currentSoundType;
  }
}

export const sound = new SoundSynthesizer();
