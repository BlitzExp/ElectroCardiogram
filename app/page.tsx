"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SourceMode = "demo" | "serial";
type SweepSpeed = 25 | 50;
type Gain = 0.5 | 1 | 2;

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface NavigatorWithSerial extends Navigator {
  serial?: { requestPort(): Promise<SerialPortLike> };
}

const SAMPLE_RATE = 250;
const MAX_SAMPLES = SAMPLE_RATE * 12;
const BAUD_RATE = 115200;
const DEMO_BPM = 72;
const DEMO_BEAT_SAMPLES = Math.round((60 / DEMO_BPM) * SAMPLE_RATE);

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
}

function demoSample(sampleIndex: number) {
  const phase = (sampleIndex % DEMO_BEAT_SAMPLES) / DEMO_BEAT_SAMPLES;
  const gaussian = (center: number, width: number, amplitude: number) =>
    amplitude * Math.exp(-0.5 * Math.pow((phase - center) / width, 2));

  return (
    2048 +
    gaussian(0.18, 0.025, 105) -
    gaussian(0.37, 0.009, 155) +
    gaussian(0.4, 0.008, 1030) -
    gaussian(0.435, 0.012, 260) +
    gaussian(0.67, 0.055, 210) +
    Math.sin(sampleIndex / 80) * 12 +
    (Math.random() - 0.5) * 18
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<number[]>([]);
  const sampleIndexRef = useRef(0);
  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const stopReadingRef = useRef(false);
  const lastUiUpdateRef = useRef(0);
  const peakRef = useRef({ previousTwo: 0, previous: 0, lastPeak: -1000, intervals: [] as number[] });
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const pausedRef = useRef(false);

  const [source, setSource] = useState<SourceMode>("demo");
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastSample, setLastSample] = useState<number | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [bpm, setBpm] = useState<number | null>(72);
  const [elapsed, setElapsed] = useState(0);
  const [gain, setGain] = useState<Gain>(1);
  const [sweepSpeed, setSweepSpeed] = useState<SweepSpeed>(25);
  const [message, setMessage] = useState("Demo signal active");
  const [serialSupported, setSerialSupported] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const playHeartbeatSound = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (!soundEnabledRef.current || pausedRef.current || !audioContext) return;

    const start = audioContext.currentTime;
    const tone = audioContext.createOscillator();
    const overtone = audioContext.createOscillator();
    const toneGain = audioContext.createGain();
    const overtoneGain = audioContext.createGain();
    const monitorFilter = audioContext.createBiquadFilter();

    tone.type = "square";
    tone.frequency.setValueAtTime(1040, start);
    tone.frequency.exponentialRampToValueAtTime(990, start + 0.075);
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(2080, start);
    monitorFilter.type = "lowpass";
    monitorFilter.frequency.setValueAtTime(2600, start);
    monitorFilter.Q.setValueAtTime(0.7, start);

    toneGain.gain.setValueAtTime(0.0001, start);
    toneGain.gain.exponentialRampToValueAtTime(0.11, start + 0.002);
    toneGain.gain.setValueAtTime(0.095, start + 0.045);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.105);
    overtoneGain.gain.setValueAtTime(0.0001, start);
    overtoneGain.gain.exponentialRampToValueAtTime(0.018, start + 0.002);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);

    tone.connect(toneGain).connect(monitorFilter);
    overtone.connect(overtoneGain).connect(monitorFilter);
    monitorFilter.connect(audioContext.destination);
    tone.start(start);
    overtone.start(start);
    tone.stop(start + 0.11);
    overtone.stop(start + 0.05);
  }, []);

  const toggleSound = async () => {
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      return;
    }

    try {
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      playHeartbeatSound();
    } catch {
      setMessage("Sound could not start in this browser");
    }
  };

  const resetSignal = useCallback(() => {
    samplesRef.current = [];
    sampleIndexRef.current = 0;
    peakRef.current = { previousTwo: 0, previous: 0, lastPeak: -1000, intervals: [] };
    setLastSample(null);
    setSampleCount(0);
    setElapsed(0);
  }, []);

  const ingestSamples = useCallback((incoming: number[], mode: SourceMode) => {
    if (!incoming.length) return;

    const buffer = samplesRef.current;
    for (const value of incoming) {
      if (!Number.isFinite(value)) continue;
      buffer.push(value);
      sampleIndexRef.current += 1;

      if (mode === "serial" && buffer.length > 20) {
        const recent = buffer.slice(-Math.min(SAMPLE_RATE, buffer.length));
        const low = Math.min(...recent);
        const high = Math.max(...recent);
        const threshold = low + (high - low) * 0.72;
        const detector = peakRef.current;

        if (
          detector.previous > detector.previousTwo &&
          detector.previous >= value &&
          detector.previous > threshold &&
          high - low > 4 &&
          sampleIndexRef.current - detector.lastPeak > SAMPLE_RATE * 0.32
        ) {
          playHeartbeatSound();
          if (detector.lastPeak > 0) {
            const interval = (sampleIndexRef.current - 1 - detector.lastPeak) / SAMPLE_RATE;
            const estimate = 60 / interval;
            if (estimate >= 30 && estimate <= 220) {
              detector.intervals.push(estimate);
              detector.intervals = detector.intervals.slice(-5);
              setBpm(Math.round(detector.intervals.reduce((sum, item) => sum + item, 0) / detector.intervals.length));
            }
          }
          detector.lastPeak = sampleIndexRef.current - 1;
        }

        detector.previousTwo = detector.previous;
        detector.previous = value;
      }
    }

    if (buffer.length > MAX_SAMPLES) buffer.splice(0, buffer.length - MAX_SAMPLES);

    const now = performance.now();
    if (now - lastUiUpdateRef.current > 80) {
      setLastSample(incoming[incoming.length - 1]);
      setSampleCount(sampleIndexRef.current);
      lastUiUpdateRef.current = now;
    }
  }, [playHeartbeatSound]);

  useEffect(() => {
    setSerialSupported(Boolean((navigator as NavigatorWithSerial).serial));
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => () => {
    soundEnabledRef.current = false;
    void audioContextRef.current?.close();
  }, []);

  useEffect(() => {
    if (source !== "demo" || paused) return;

    const interval = window.setInterval(() => {
      const next: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const nextSampleIndex = sampleIndexRef.current + index;
        if (nextSampleIndex % DEMO_BEAT_SAMPLES === Math.round(DEMO_BEAT_SAMPLES * 0.4)) {
          playHeartbeatSound();
        }
        next.push(demoSample(nextSampleIndex));
      }
      ingestSamples(next, "demo");
    }, 20);

    return () => window.clearInterval(interval);
  }, [ingestSamples, paused, playHeartbeatSound, source]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [paused, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let animationFrame = 0;

    const draw = () => {
      const density = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== Math.floor(width * density) || canvas.height !== Math.floor(height * density)) {
        canvas.width = Math.floor(width * density);
        canvas.height = Math.floor(height * density);
      }

      context.setTransform(density, 0, 0, density, 0, 0);
      context.clearRect(0, 0, width, height);

      const secondsVisible = sweepSpeed === 25 ? 8 : 4;
      const pointsVisible = secondsVisible * SAMPLE_RATE;
      const data = samplesRef.current.slice(-pointsVisible);
      if (data.length > 1) {
        let center = 2048;
        let amplitude = 1150;

        if (source === "serial") {
          const low = Math.min(...data);
          const high = Math.max(...data);
          center = (low + high) / 2;
          amplitude = Math.max((high - low) * 0.62, 1);
        }

        context.strokeStyle = "#ecff78";
        context.lineWidth = 2;
        context.lineJoin = "round";
        context.shadowColor = "rgba(225, 255, 68, 0.38)";
        context.shadowBlur = 7;
        context.beginPath();

        const startX = width - ((data.length - 1) / (pointsVisible - 1)) * width;
        data.forEach((value, index) => {
          const x = startX + (index / (pointsVisible - 1)) * width;
          const normalized = ((value - center) / amplitude) * gain;
          const y = height * 0.53 - normalized * height * 0.36;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [gain, source, sweepSpeed]);

  const readSerial = useCallback(async (port: SerialPortLike) => {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    readerRef.current = reader;
    let pending = "";

    try {
      while (!stopReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        const parsed = lines
          .map((line) => line.trim().split(/[\s,;]+/).at(-1))
          .map((value) => Number(value))
          .filter(Number.isFinite);
        ingestSamples(parsed, "serial");
      }
    } catch (error) {
      if (!stopReadingRef.current) {
        setMessage(error instanceof Error ? `Serial error: ${error.message}` : "Serial connection was interrupted");
      }
    } finally {
      try { reader.releaseLock(); } catch { /* Reader may already be released. */ }
      readerRef.current = null;
    }
  }, [ingestSamples]);

  const connect = async () => {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial) {
      setMessage("USB serial requires Chrome or Edge on desktop");
      setSerialSupported(false);
      return;
    }

    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      stopReadingRef.current = false;
      portRef.current = port;
      resetSignal();
      setSource("serial");
      setConnected(true);
      setPaused(false);
      setBpm(null);
      setMessage("Receiving newline-delimited values");
      void readSerial(port);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        setMessage("No serial device selected — demo is still running");
      } else {
        setMessage(error instanceof Error ? error.message : "Unable to open the serial device");
      }
    }
  };

  const disconnect = useCallback(async () => {
    stopReadingRef.current = true;
    try { await readerRef.current?.cancel(); } catch { /* Port may already be gone. */ }
    try { await portRef.current?.close(); } catch { /* Port may already be closed. */ }
    readerRef.current = null;
    portRef.current = null;
    setConnected(false);
    setSource("demo");
    setPaused(false);
    setBpm(72);
    resetSignal();
    setMessage("Demo signal active");
  }, [resetSignal]);

  useEffect(() => () => { void disconnect(); }, [disconnect]);

  const modeLabel = source === "serial" ? "USB serial" : "Demo signal";
  const quality = source === "demo" ? "Demo" : sampleCount > 25 ? "Receiving" : "Waiting";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">N</span>
          <div>
            <p className="eyebrow">ECG monitor</p>
            <h1>CardioScope</h1>
          </div>
        </div>
        <div className="header-actions">
          <button
            className={`sound-toggle ${soundEnabled ? "is-active" : ""}`}
            type="button"
            aria-pressed={soundEnabled}
            onClick={toggleSound}
          >
            <span aria-hidden="true">♪</span>
            {soundEnabled ? "Sound on" : "Enable sound"}
          </button>
          <span className={`device-state ${connected ? "is-connected" : ""}`}>
            <i /> {connected ? "ESP32 connected" : "Demo mode"}
          </span>
          <button className="connect-button" type="button" onClick={connected ? disconnect : connect}>
            {connected ? "Disconnect" : "Connect USB"}
          </button>
        </div>
      </header>

      <section className="monitor-layout">
        <div className="display-panel">
          <div className="display-toolbar">
            <div>
              <span className="live-indicator"><i /> {paused ? "Signal paused" : modeLabel}</span>
              <h2>Lead I</h2>
            </div>
            <div className="signal-meta">
              <span>{sweepSpeed} mm/s</span>
              <span>{gain}× gain</span>
              <details className="signal-settings">
                <summary aria-label="Signal settings">•••</summary>
                <div className="settings-menu">
                  <p>Sweep speed</p>
                  <div>
                    {[25, 50].map((speed) => (
                      <button className={sweepSpeed === speed ? "active" : ""} key={speed} onClick={() => setSweepSpeed(speed as SweepSpeed)}>{speed}</button>
                    ))}
                  </div>
                  <p>Gain</p>
                  <div>
                    {[0.5, 1, 2].map((value) => (
                      <button className={gain === value ? "active" : ""} key={value} onClick={() => setGain(value as Gain)}>{value}×</button>
                    ))}
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div className="waveform-stage">
            <div className="lead-label">I</div>
            <canvas ref={canvasRef} className="waveform-canvas" aria-label={`${modeLabel} electrocardiogram waveform`} />
            <div className="sweep-line" />
            <span className="stage-note">{paused ? "Paused" : source === "serial" ? "Live input" : "Synthetic preview"}</span>
          </div>

          <div className="display-footer">
            <span>0 s</span><span>{sweepSpeed === 25 ? "2 s" : "1 s"}</span><span>{sweepSpeed === 25 ? "4 s" : "2 s"}</span><span>{sweepSpeed === 25 ? "6 s" : "3 s"}</span><span>{sweepSpeed === 25 ? "8 s" : "4 s"}</span>
          </div>
        </div>

        <aside className="vitals-panel">
          <div className="vital-primary">
            <div className="vital-heading"><span>Heart rate</span><span className="unit">BPM</span></div>
            <strong>{bpm ?? "—"}</strong>
            <p><i /> {bpm ? (bpm >= 50 && bpm <= 100 ? "Within range" : "Check rate") : "Detecting rhythm"}</p>
          </div>
          <div className="divider" />
          <div className="vital-secondary">
            <span>Signal</span>
            <strong>{quality}</strong>
            <div className={`signal-bars ${sampleCount > 25 ? "active" : ""}`} aria-label={`${quality} signal`}><i /><i /><i /><i /></div>
          </div>
          <div className="divider" />
          <div className="session-block">
            <span>Session</span>
            <strong>{formatDuration(elapsed)}</strong>
            <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Resume" : "Pause"}</button>
          </div>
        </aside>
      </section>

      <footer className="status-footer">
        <p><span>Serial input</span><strong>{message}</strong></p>
        <p><span>Baud rate</span><strong>{BAUD_RATE.toLocaleString()}</strong></p>
        <p><span>Latest sample</span><strong>{lastSample === null ? "—" : Math.round(lastSample)}</strong></p>
        <p><span>Samples received</span><strong>{sampleCount.toLocaleString()}</strong></p>
        <small>{serialSupported ? "Visualization only · Not for diagnostic use" : "Use desktop Chrome or Edge for USB access"}</small>
      </footer>
    </main>
  );
}
