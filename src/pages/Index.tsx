import { useState, useCallback, useRef, useEffect } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Volume2, VolumeX, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import AgentPanel from "@/components/AgentPanel";
import AgentDiscussion from "@/components/AgentDiscussion";
import {
  useSync,
  type AgentScope,
  type AgentMessage,
  type PendingActivation,
} from "@/hooks/useSync";

const STEPS = 16;
const ROWS = 16; // 4 rows per instrument: kick, guitar, piano, synth

// TROUBLESHOOTING: Set to true to bypass all effects (distortion, reverb) and hear raw synths.
// Compare with false to see if the "synthy" sound comes from effects or from the oscillators.
const BYPASS_EFFECTS = false;
// Rows 0-3: kick (low), 4-7: guitar, 8-11: piano, 12-15: synth
const NOTE_NAMES = [
  "C2", "C#2", "D2", "D#2",   // kick (main, punch, accent, ghost)
  "E2", "G2", "B2", "E3",     // guitar (low to high)
  "C3", "E3", "G3", "C4",     // piano
  "G3", "A3", "C4", "E4",     // synth/default
];
const ROW_LABELS = [
  "K1", "K2", "K3", "K4",    // Kick
  "G1", "G2", "G3", "G4",    // Guitar
  "P1", "P2", "P3", "P4",    // Piano
  "S1", "S2", "S3", "S4",    // Synth
];

type Grid = boolean[][];
type VelocityGrid = number[][];
type LengthGrid = string[][];

/** Instrument that can play notes and has a volume control (for mute/master). */
type ChainSynth =
  | Tone.PolySynth<Tone.MonoSynth>
  | Tone.MembraneSynth
  | Tone.PolySynth<Tone.Synth>;
type PlayableInstrument =
  | Tone.PolySynth<Tone.Synth<Tone.SynthOptions>>
  | { synth: ChainSynth; volume: Tone.Volume };

function isChainInstrument(
  inst: PlayableInstrument
): inst is { synth: ChainSynth; volume: Tone.Volume } {
  return "synth" in inst && "volume" in inst;
}

const createEmptyGrid = (): Grid =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(false));
const createEmptyVelocityGrid = (): VelocityGrid =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(0.8));
const createEmptyLengthGrid = (): LengthGrid =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill("16n"));

const Index = () => {
  const [grid, setGrid] = useState<Grid>(createEmptyGrid);
  const [velocityGrid, setVelocityGrid] = useState<VelocityGrid>(createEmptyVelocityGrid);
  const [lengthGrid, setLengthGrid] = useState<LengthGrid>(createEmptyLengthGrid);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const [volume, setVolume] = useState(-6);
  const [isMuted, setIsMuted] = useState(false);
  const [agentScopes, setAgentScopes] = useState<AgentScope[]>([]);
  const [pendingActivations, setPendingActivations] = useState<PendingActivation[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [humanPrompt, setHumanPrompt] = useState("");

  const synthRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  /** Per-agent instruments. Keys: agent name (e.g. "PULSE") or "default". */
  const instrumentsRef = useRef<Record<string, PlayableInstrument>>({});
  const sequenceRef = useRef<Tone.Sequence | null>(null);
  const gridRef = useRef(grid);
  const velocityGridRef = useRef(velocityGrid);
  const lengthGridRef = useRef(lengthGrid);
  const agentScopesRef = useRef<AgentScope[]>([]);
  const activeAgreementRef = useRef<AgentMessage["agreement"] | null>(null);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    velocityGridRef.current = velocityGrid;
  }, [velocityGrid]);

  useEffect(() => {
    lengthGridRef.current = lengthGrid;
  }, [lengthGrid]);

  useEffect(() => {
    agentScopesRef.current = agentScopes;
  }, [agentScopes]);

  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.agreement) {
        activeAgreementRef.current = messages[i].agreement;
        return;
      }
    }
    activeAgreementRef.current = null;
  }, [messages]);

  const getAccentMultiplier = (step: number, accentPattern?: string) => {
    switch ((accentPattern || "").toLowerCase()) {
      case "four_on_floor":
        return step % 4 === 0 ? 1.2 : 0.88;
      case "backbeat":
        return step % 8 === 4 ? 1.22 : step % 4 === 0 ? 0.95 : 0.9;
      case "push":
        return step % 4 === 3 ? 1.18 : step % 4 === 0 ? 0.94 : 0.9;
      case "syncopated":
        return step % 4 === 2 || step % 4 === 3 ? 1.14 : 0.92;
      default:
        return 1;
    }
  };

  const initAudio = useCallback(async () => {
    await Tone.start();
    if (synthRef.current) return;

    // Default: soft sound (no beep) when no per-agent instrument is set
    const defaultSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.4 },
    }).toDestination();
    defaultSynth.volume.value = volume;
    synthRef.current = defaultSynth;
    instrumentsRef.current.default = defaultSynth;

    // PULSE: rock drum kick (MembraneSynth)
    const kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
    });
    const kickVol = new Tone.Volume(volume).toDestination();
    if (BYPASS_EFFECTS) {
      kickSynth.connect(kickVol);
    } else {
      const kickDistortion = new Tone.Distortion({ distortion: 0.2, wet: 0.3 });
      kickSynth.connect(kickDistortion);
      kickDistortion.connect(kickVol);
    }
    instrumentsRef.current.PULSE = { synth: kickSynth, volume: kickVol };

    // WAVE: rock guitar (distorted, mid-range)
    const guitarSynth = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 },
      filter: { type: "lowpass", frequency: 2800, rolloff: -12 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.3,
        sustain: 0.5,
        release: 0.4,
        baseFrequency: 400,
        octaves: 2,
      },
    });
    const guitarVol = new Tone.Volume(volume).toDestination();
    if (BYPASS_EFFECTS) {
      guitarSynth.connect(guitarVol);
    } else {
      const guitarDistortion = new Tone.Distortion({ distortion: 0.5, wet: 0.6 });
      const guitarReverb = new Tone.Reverb({ decay: 0.6, wet: 0.2, preDelay: 0.01 });
      await guitarReverb.generate();
      guitarSynth.connect(guitarDistortion);
      guitarDistortion.connect(guitarReverb);
      guitarReverb.connect(guitarVol);
    }
    instrumentsRef.current.WAVE = { synth: guitarSynth, volume: guitarVol };

    // GHOST: piano (FM-based, no samples)
    const pianoSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.005,
        decay: 0.4,
        sustain: 0.3,
        release: 0.5,
      },
      volume: -2,
    });
    const pianoVol = new Tone.Volume(volume).toDestination();
    if (BYPASS_EFFECTS) {
      pianoSynth.connect(pianoVol);
    } else {
      const pianoReverb = new Tone.Reverb({ decay: 1.2, wet: 0.35, preDelay: 0.02 });
      await pianoReverb.generate();
      pianoSynth.connect(pianoReverb);
      pianoReverb.connect(pianoVol);
    }
    instrumentsRef.current.GHOST = { synth: pianoSynth, volume: pianoVol };
  }, [volume]);

  const startSequencer = useCallback(async () => {
    await initAudio();
    if (!synthRef.current) return;

    Tone.getTransport().bpm.value = bpm;
    Tone.getTransport().swing = Math.max(0, Math.min(0.6, activeAgreementRef.current?.swing ?? 0));
    Tone.getTransport().swingSubdivision = "8n";

    if (sequenceRef.current) {
      sequenceRef.current.dispose();
    }

    const seq = new Tone.Sequence(
      (time, step) => {
        setCurrentStep(step);
        const g = gridRef.current;
        const vg = velocityGridRef.current;
        const lg = lengthGridRef.current;
        const scopes = agentScopesRef.current;
        const instruments = instrumentsRef.current;
        const agreement = activeAgreementRef.current;

        // When only one agent is PULSE, use slap bass for all rows (robust across servers)
        const onlyPulse =
          scopes.length === 1 &&
          scopes[0].name?.toUpperCase() === "PULSE";
        for (let row = 0; row < ROWS; row++) {
          if (!g[row][step]) continue;
          const owner = scopes.find(
            (a) => row >= a.scopeStart && row <= a.scopeEnd
          );
          const key = onlyPulse
            ? "PULSE"
            : owner?.name
              ? owner.name.toUpperCase()
              : "default";
          const inst = instruments[key] ?? instruments.default;
          if (!inst) continue;
          const synth = isChainInstrument(inst) ? inst.synth : inst;
          const baseVelocity = Math.max(0.05, Math.min(1, vg[row]?.[step] ?? 0.8));
          const velocity = Math.max(0.05, Math.min(1, baseVelocity * getAccentMultiplier(step, agreement?.accentPattern)));
          const length = lg[row]?.[step] || agreement?.noteLength || "16n";
          synth.triggerAttackRelease(NOTE_NAMES[row], length, time, velocity);
        }
      },
      Array.from({ length: STEPS }, (_, i) => i),
      "16n"
    );

    seq.start(0);
    sequenceRef.current = seq;
    Tone.getTransport().start();
    setIsPlaying(true);
  }, [bpm, initAudio]);

  const stopSequencer = useCallback(() => {
    Tone.getTransport().stop();
    if (sequenceRef.current) {
      sequenceRef.current.dispose();
      sequenceRef.current = null;
    }
    setIsPlaying(false);
    setCurrentStep(-1);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      Tone.getTransport().bpm.value = bpm;
      Tone.getTransport().swing = Math.max(0, Math.min(0.6, activeAgreementRef.current?.swing ?? 0));
    }
  }, [bpm, isPlaying, messages]);

  useEffect(() => {
    const v = isMuted ? -Infinity : volume;
    if (synthRef.current) {
      synthRef.current.volume.value = v;
    }
    const instruments = instrumentsRef.current;
    for (const name of ["PULSE", "WAVE", "GHOST"] as const) {
      const inst = instruments[name];
      if (inst && isChainInstrument(inst)) {
        const vol = inst.volume as { volume: { value: number } };
        vol.volume.value = v;
      }
    }
  }, [volume, isMuted]);

  // --- Sync ---
  const { send, connectedUsers } = useSync({
    onInit(state, agents, discussion, pending) {
      setGrid(state.grid.map((r) => [...r]));
      setVelocityGrid((state.velocityGrid || createEmptyVelocityGrid()).map((r) => [...r]));
      setLengthGrid((state.lengthGrid || createEmptyLengthGrid()).map((r) => [...r]));
      setBpm(state.bpm);
      setVolume(state.volume);
      setIsMuted(state.isMuted);
      setAgentScopes(agents);
      setPendingActivations(pending);
      agentScopesRef.current = agents; // so sequencer sees correct instrument immediately
      setMessages(discussion);
      if (state.isPlaying) startSequencer();
    },
    onCellToggle(row, step, value, velocity, length) {
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][step] = value;
        return next;
      });
      setVelocityGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][step] = value ? Math.max(0.05, Math.min(1, velocity ?? next[row][step] ?? 0.8)) : 0;
        return next;
      });
      setLengthGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][step] = value ? (length || next[row][step] || "16n") : "";
        return next;
      });
    },
    onBpmChange(b) {
      setBpm(b);
    },
    onVolumeChange(v) {
      setVolume(v);
    },
    onMutedChange(m) {
      setIsMuted(m);
    },
    onPlayStateChange(playing) {
      if (playing) startSequencer();
      else stopSequencer();
    },
    onScopeUpdate(agents) {
      setAgentScopes(agents);
      agentScopesRef.current = agents; // so sequencer uses PULSE/etc. right away
    },
    onActivationUpdate(pending) {
      setPendingActivations(pending);
    },
    onAgentMessage(message) {
      setMessages((prev) => [...prev, message]);
    },
    onResetDiscussion() {
      setMessages([]);
    },
  });

  // --- Actions ---
  const handlePlay = useCallback(async () => {
    await startSequencer();
    send({ type: "play_state", isPlaying: true });
  }, [startSequencer, send]);

  const handleStop = useCallback(() => {
    stopSequencer();
    send({ type: "play_state", isPlaying: false });
  }, [stopSequencer, send]);

  const handleBpm = useCallback(
    (v: number) => {
      setBpm(v);
      send({ type: "bpm_change", bpm: v });
    },
    [send]
  );

  const handleVolume = useCallback(
    (v: number) => {
      setVolume(v);
      send({ type: "volume_change", volume: v });
    },
    [send]
  );

  const handleMute = useCallback(() => {
    setIsMuted((prev) => {
      send({ type: "muted_change", isMuted: !prev });
      return !prev;
    });
  }, [send]);

  const handleActivateAgent = useCallback(
    (personality: string) => {
      send({ type: "activate_agent", personality });
    },
    [send]
  );

  const handleDeactivateAgent = useCallback(
    (personality: string) => {
      send({ type: "deactivate_agent", personality });
    },
    [send]
  );

  const handleReset = useCallback(() => {
    send({ type: "reset_session" });
  }, [send]);

  const handleSendHumanPrompt = useCallback(() => {
    const text = humanPrompt.trim();
    if (!text) return;
    send({
      type: "agent_message",
      agentId: "",
      name: "DIRECTOR",
      color: "hsl(12, 90%, 65%)",
      kind: "chat",
      text,
      timestamp: Date.now(),
    });
    setHumanPrompt("");
  }, [humanPrompt, send]);

  // --- Scope helpers ---
  function getRowOwner(rowIdx: number): AgentScope | undefined {
    return agentScopes.find(
      (a) => rowIdx >= a.scopeStart && rowIdx <= a.scopeEnd
    );
  }

  function isScopeBoundary(rowIdx: number): AgentScope | undefined {
    return agentScopes.find((a) => a.scopeStart === rowIdx && rowIdx > 0);
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Scanline overlay */}
      <div className="scanline fixed inset-0 z-50" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1
            className="text-4xl md:text-5xl font-bold tracking-widest text-primary mb-2"
            style={{ fontFamily: "Orbitron, monospace" }}
          >
            Music Agents
          </h1>
          <p className="text-muted-foreground text-sm tracking-[0.3em] uppercase">
            ai-agent-first live jam space
          </p>
        </motion.div>

        {/* 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
          {/* Left column: controls + grid */}
          <div>
            {/* Controls */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex flex-wrap items-center gap-3 mb-6"
            >
              <Button
                onClick={isPlaying ? handleStop : handlePlay}
                className="gap-2 font-bold tracking-wider border border-primary bg-primary/10 text-primary hover:bg-primary/20"
                size="lg"
              >
                {isPlaying ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isPlaying ? "STOP" : "PLAY"}
              </Button>

              <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 border border-border">
                <span className="text-xs text-muted-foreground w-8">BPM</span>
                <Slider
                  value={[bpm]}
                  onValueChange={([v]) => handleBpm(v)}
                  min={60}
                  max={200}
                  step={1}
                  className="w-28"
                />
                <span className="text-primary text-sm font-bold w-8">
                  {bpm}
                </span>
              </div>

              <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 border border-border">
                <button
                  onClick={handleMute}
                  className="text-muted-foreground hover:text-primary"
                >
                  {isMuted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <Slider
                  value={[volume]}
                  onValueChange={([v]) => handleVolume(v)}
                  min={-30}
                  max={0}
                  step={1}
                  className="w-20"
                />
              </div>
            </motion.div>

            {/* Agent Buttons */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="mb-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h2
                  className="text-xs font-bold tracking-[0.3em] text-muted-foreground"
                  style={{ fontFamily: "Orbitron, monospace" }}
                >
                  AGENTS
                </h2>
                {agentScopes.length > 0 && (
                  <Button
                    onClick={handleReset}
                    variant="destructive"
                    size="sm"
                    className="text-[10px] tracking-wider gap-1.5 h-6"
                  >
                    <RotateCcw className="w-3 h-3" />
                    RESET ALL
                  </Button>
                )}
              </div>
              <AgentPanel
                connectedAgents={agentScopes}
                pendingAgents={pendingActivations.map((activation) => activation.personality)}
                onActivateAgent={handleActivateAgent}
                onDeactivateAgent={handleDeactivateAgent}
              />
            </motion.div>

            {/* Grid — 16 rows × 16 steps, scroll when needed */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="border border-border rounded-lg bg-card/50 p-3 md:p-4 overflow-auto max-h-[70vh]"
            >
              <div className="min-w-[640px]">
                {grid.map((row, rowIdx) => {
                  const owner = getRowOwner(rowIdx);
                  const boundary = isScopeBoundary(rowIdx);
                  return (
                    <div key={rowIdx}>
                      {/* Scope divider */}
                      {boundary && (
                        <div
                          className="h-0.5 mx-10 my-1 rounded-full opacity-60"
                          style={{ backgroundColor: boundary.color }}
                        />
                      )}
                      <div className="flex items-center gap-1 mb-1">
                        <span
                          className="w-10 text-[10px] font-bold tracking-wider text-right pr-2 shrink-0"
                          style={{
                            fontFamily: "Orbitron, monospace",
                            color: owner?.color || "hsl(var(--muted-foreground))",
                          }}
                        >
                          {ROW_LABELS[rowIdx]}
                        </span>
                        {row.map((active, colIdx) => {
                          const isCurrentStep =
                            currentStep === colIdx && isPlaying;
                          const isBeat = colIdx % 4 === 0;
                          return (
                            <div
                              key={colIdx}
                              className={`
                                flex-1 aspect-square rounded-sm transition-all duration-75 border
                                ${
                                  active
                                    ? "border-current grid-cell-active"
                                    : isBeat
                                      ? "bg-muted/60 border-border/60"
                                      : "bg-muted/30 border-border/30"
                                }
                                ${isCurrentStep && active ? "grid-cell-playing" : ""}
                                ${isCurrentStep && !active ? "border-secondary/40" : ""}
                              `}
                              style={
                                active && owner
                                  ? {
                                      backgroundColor: owner.color + "44",
                                      borderColor: owner.color,
                                      boxShadow: `0 0 8px ${owner.color}55`,
                                    }
                                  : active
                                    ? {
                                        backgroundColor: "hsl(var(--primary) / 0.8)",
                                        borderColor: "hsl(var(--primary))",
                                      }
                                    : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Step indicators */}
                <div className="flex items-center gap-1 mt-2">
                  <span className="w-10 shrink-0" />
                  {Array.from({ length: STEPS }, (_, i) => (
                    <div
                      key={i}
                      className={`flex-1 text-center text-[8px] font-bold ${
                        currentStep === i && isPlaying
                          ? "text-secondary"
                          : i % 4 === 0
                            ? "text-muted-foreground"
                            : "text-muted-foreground/40"
                      }`}
                      style={{ fontFamily: "Orbitron, monospace" }}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Status bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-3 flex items-center justify-between text-xs text-muted-foreground border border-border rounded px-4 py-2 bg-card/30"
            >
              <div className="flex items-center gap-2">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={connectedUsers}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    <span>
                      {connectedUsers} user
                      {connectedUsers !== 1 ? "s" : ""} connected
                    </span>
                  </motion.span>
                </AnimatePresence>
                {agentScopes.length > 0 && (
                  <span className="text-muted-foreground/60">
                    | {agentScopes.length} agent
                    {agentScopes.length !== 1 ? "s" : ""} active
                  </span>
                )}
              </div>
              <span
                className="tracking-widest"
                style={{ fontFamily: "Orbitron, monospace" }}
              >
                OBSERVER MODE
              </span>
            </motion.div>
          </div>

          {/* Right column: discussion */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:h-[calc(100vh-12rem)] min-h-[400px]"
          >
            <AgentDiscussion
              messages={messages}
              agents={agentScopes}
              humanPrompt={humanPrompt}
              onHumanPromptChange={setHumanPrompt}
              onSendHumanPrompt={handleSendHumanPrompt}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Index;
