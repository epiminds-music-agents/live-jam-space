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
const ROWS = 16; // drums(0-3), bass(4-7), keys(8-11), lead(12-15)

// A minor pentatonic: A C D E G — pleasant in any combination
const NOTE_NAMES = [
  "C1", "D1", "F#5", "A5",  // drums  (MembraneSynth uses C1/D1 for pitch; hats use F#5/A5)
  "A2", "C3", "D3", "E3",  // bass   (low sub-bass register)
  "A3", "C4", "E4", "G4",  // keys   (mid register)
  "A4", "C5", "E5", "G5",  // lead   (high register)
];
const ROW_LABELS = [
  "KCK", "SNR", "CHH", "OHH",
  "A2", "C3", "D3", "E3",
  "A3", "C4", "E4", "G4",
  "A4", "C5", "E5", "G5",
];

type Grid = boolean[][];
type VelocityGrid = number[][];
type LengthGrid = string[][];

type ChainSynth =
  | Tone.PolySynth<Tone.MonoSynth>
  | Tone.PolySynth<Tone.Synth>
  | Tone.PolySynth<Tone.AMSynth>
  | Tone.MembraneSynth
  | Tone.NoiseSynth
  | Tone.MetalSynth;

/** Drum kit — each row within PULSE maps to a distinct percussive synth. */
type DrumKit = {
  isDrumKit: true;
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hhClosed: Tone.MetalSynth;
  hhOpen: Tone.MetalSynth;
  volume: Tone.Volume;
};

type PlayableInstrument =
  | Tone.PolySynth<Tone.Synth<Tone.SynthOptions>>
  | { synth: ChainSynth; volume: Tone.Volume }
  | DrumKit;

function isChainInstrument(
  inst: PlayableInstrument
): inst is { synth: ChainSynth; volume: Tone.Volume } {
  return "synth" in inst && "volume" in inst && !("isDrumKit" in inst);
}

function isDrumKit(inst: PlayableInstrument): inst is DrumKit {
  return "isDrumKit" in inst;
}

// ── Instrument group metadata ──────────────────────────────────────────────
const GROUP_INFO = [
  {
    name: "DRUMS", color: "hsl(180,60%,55%)",
    presets: [
      { id: "electronic", short: "ELEC" },
      { id: "acoustic", short: "ACST" },
      { id: "trap", short: "TRAP" },
    ],
  },
  {
    name: "BASS", color: "hsl(35,80%,58%)",
    presets: [
      { id: "pluck", short: "PLCK" },
      { id: "sub", short: "SUB" },
      { id: "acid", short: "ACID" },
    ],
  },
  {
    name: "KEYS", color: "hsl(285,55%,65%)",
    presets: [
      { id: "epiano", short: "EPNO" },
      { id: "bells", short: "BELL" },
      { id: "pad", short: "PAD" },
    ],
  },
  {
    name: "LEAD", color: "hsl(142,50%,55%)",
    presets: [
      { id: "pulse", short: "PLS" },
      { id: "saw", short: "SAW" },
      { id: "stab", short: "STAB" },
    ],
  },
] as const;

// ── Instrument creation (standalone async helpers) ─────────────────────────
async function createDrums(preset: string, vol: number, out: Tone.ToneAudioNode): Promise<DrumKit> {
  const bus = new Tone.Volume(vol).connect(out);
  const p = preset === "acoustic" ? { pd: 0.04, oct: 6, dist: 0.08, snareCut: 1800, hhDec: 0.09, hhODec: 0.65, hhRev: 0.3 }
    : preset === "trap" ? { pd: 0.12, oct: 10, dist: 0.55, snareCut: 4200, hhDec: 0.025, hhODec: 1.0, hhRev: 0.1 }
      : { pd: 0.07, oct: 9, dist: 0.3, snareCut: 2800, hhDec: 0.055, hhODec: 0.38, hhRev: 0.15 };

  const kick = new Tone.MembraneSynth({ pitchDecay: p.pd, octaves: p.oct, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.15 } });
  kick.chain(new Tone.Distortion({ distortion: p.dist, wet: 0.4 }), new Tone.EQ3({ low: 4, mid: -4, high: -8 }), bus);

  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 } });
  snare.volume.value = 3;
  snare.chain(new Tone.Filter({ type: "bandpass", frequency: p.snareCut, Q: 0.9 }), new Tone.EQ3({ low: -10, mid: 5, high: 8 }), bus);

  const hhClosed = new Tone.MetalSynth({ frequency: 400, harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5, envelope: { attack: 0.001, decay: p.hhDec, release: 0.01 } });
  hhClosed.volume.value = -7;
  hhClosed.chain(new Tone.Filter({ type: "highpass", frequency: 8000 }), bus);

  const hhOpen = new Tone.MetalSynth({ frequency: 400, harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5, envelope: { attack: 0.001, decay: p.hhODec, release: 0.12 } });
  hhOpen.volume.value = -9;
  const hhRev = new Tone.Reverb({ decay: 0.5, wet: p.hhRev });
  await hhRev.generate();
  hhOpen.chain(new Tone.Filter({ type: "highpass", frequency: 7500 }), hhRev, bus);

  return { isDrumKit: true, kick, snare, hhClosed, hhOpen, volume: bus };
}

async function createBass(preset: string, vol: number, out: Tone.ToneAudioNode): Promise<{ synth: ChainSynth; volume: Tone.Volume }> {
  const bus = new Tone.Volume(vol).connect(out);

  if (preset === "sub") {
    const sub = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.015, decay: 0.5, sustain: 0.75, release: 0.6 }, volume: -2 });
    sub.chain(new Tone.Filter({ type: "lowpass", frequency: 280, rolloff: -24 }), new Tone.Compressor({ threshold: -18, ratio: 6, attack: 0.002, release: 0.12 }), bus);
    return { synth: sub, volume: bus };
  }

  if (preset === "acid") {
    const acid = new Tone.PolySynth(Tone.MonoSynth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.5, release: 0.15 }, filter: { type: "lowpass", frequency: 500, rolloff: -24, Q: 9 }, filterEnvelope: { attack: 0.002, decay: 0.15, sustain: 0.4, release: 0.1, baseFrequency: 100, octaves: 5 } });
    acid.chain(new Tone.Compressor({ threshold: -22, ratio: 5, attack: 0.002, release: 0.15 }), bus);
    return { synth: acid, volume: bus };
  }

  // pluck (default)
  const bass = new Tone.PolySynth(Tone.MonoSynth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.003, decay: 0.22, sustain: 0.12, release: 0.18 }, filter: { type: "lowpass", frequency: 900, rolloff: -24 }, filterEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.25, release: 0.2, baseFrequency: 180, octaves: 3.5 } });
  bass.chain(new Tone.Compressor({ threshold: -22, ratio: 5, attack: 0.002, release: 0.15 }), bus);
  return { synth: bass, volume: bus };
}

async function createKeys(preset: string, vol: number, out: Tone.ToneAudioNode): Promise<{ synth: ChainSynth; volume: Tone.Volume }> {
  const bus = new Tone.Volume(vol).connect(out);

  if (preset === "bells") {
    const bells = new Tone.PolySynth(Tone.AMSynth, { harmonicity: 3.5, oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.6 }, modulation: { type: "triangle" }, modulationEnvelope: { attack: 0.06, decay: 0.5, sustain: 0, release: 0.5 }, volume: -4 });
    const rev = new Tone.Reverb({ decay: 3.2, wet: 0.38, preDelay: 0.02 });
    await rev.generate();
    bells.chain(rev, bus);
    return { synth: bells as unknown as ChainSynth, volume: bus };
  }

  if (preset === "pad") {
    const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.55, decay: 0.1, sustain: 0.8, release: 2.0 }, volume: -5 });
    const chorus = new Tone.Chorus(2.2, 3, 0.6).start();
    const rev = new Tone.Reverb({ decay: 4.5, wet: 0.5, preDelay: 0.02 });
    await rev.generate();
    pad.chain(chorus, rev, bus);
    return { synth: pad, volume: bus };
  }

  // epiano (default)
  const keys = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.008, decay: 0.55, sustain: 0.18, release: 0.65 }, volume: -2 });
  const chorus = new Tone.Chorus(3.5, 2.5, 0.45).start();
  const rev = new Tone.Reverb({ decay: 2.2, wet: 0.3, preDelay: 0.015 });
  await rev.generate();
  keys.chain(chorus, rev, bus);
  return { synth: keys, volume: bus };
}

async function createLead(preset: string, vol: number, out: Tone.ToneAudioNode): Promise<{ synth: ChainSynth; volume: Tone.Volume }> {
  const bus = new Tone.Volume(vol - 2).connect(out);

  if (preset === "saw") {
    const saw = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.5 }, volume: -4 });
    const chorus = new Tone.Chorus(4, 2, 0.35).start();
    const rev = new Tone.Reverb({ decay: 1.2, wet: 0.18 });
    await rev.generate();
    saw.chain(new Tone.Filter({ type: "lowpass", frequency: 3200, rolloff: -12 }), chorus, rev, bus);
    return { synth: saw, volume: bus };
  }

  if (preset === "stab") {
    const stab = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "square" }, envelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.06 }, volume: -3 });
    stab.chain(new Tone.Filter({ type: "bandpass", frequency: 2200, Q: 1.5 }), new Tone.Distortion({ distortion: 0.2, wet: 0.3 }), bus);
    return { synth: stab, volume: bus };
  }

  // pulse (default)
  const lead = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "pulse", width: 0.3 } as Tone.OmniOscillatorOptions, envelope: { attack: 0.006, decay: 0.18, sustain: 0.55, release: 0.75 }, volume: -4 });
  const rev = new Tone.Reverb({ decay: 1.6, wet: 0.22, preDelay: 0.01 });
  await rev.generate();
  lead.chain(new Tone.Filter({ type: "lowpass", frequency: 4200, rolloff: -12 }), new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.28, wet: 0.22 }), rev, bus);
  return { synth: lead, volume: bus };
}

async function createGroupInstrument(groupIdx: number, presetId: string, vol: number, out: Tone.ToneAudioNode): Promise<PlayableInstrument> {
  if (groupIdx === 0) return createDrums(presetId, vol, out);
  if (groupIdx === 1) return createBass(presetId, vol, out);
  if (groupIdx === 2) return createKeys(presetId, vol, out);
  return createLead(presetId, vol, out);
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

  const [groupPresets, setGroupPresets] = useState<string[]>(["electronic", "pluck", "epiano", "pulse"]);
  const groupPresetsRef = useRef<string[]>(["electronic", "pluck", "epiano", "pulse"]);

  const synthRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  const masterLimiterRef = useRef<Tone.Limiter | null>(null);
  /** Instruments keyed by "group_0".."group_3" and "default". */
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

    // Master bus: all groups → limiter → compressor → speakers
    const masterComp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.003, release: 0.25, knee: 6 }).toDestination();
    const limiter = new Tone.Limiter(-3).connect(masterComp);
    masterLimiterRef.current = limiter;

    // Silent fallback synth (used for unowned rows)
    const defaultSynth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.4 }, volume: volume }).connect(limiter);
    synthRef.current = defaultSynth;
    instrumentsRef.current.default = defaultSynth;

    // Create all 4 groups using the current preset selections
    const presets = groupPresetsRef.current;
    const [g0, g1, g2, g3] = await Promise.all([
      createGroupInstrument(0, presets[0], volume, limiter),
      createGroupInstrument(1, presets[1], volume, limiter),
      createGroupInstrument(2, presets[2], volume, limiter),
      createGroupInstrument(3, presets[3], volume, limiter),
    ]);
    instrumentsRef.current.group_0 = g0;
    instrumentsRef.current.group_1 = g1;
    instrumentsRef.current.group_2 = g2;
    instrumentsRef.current.group_3 = g3;
  }, [volume]);

  const switchGroupPreset = useCallback(async (groupIdx: number, presetId: string) => {
    // Update visual state immediately so buttons reflect the change
    const newPresets = [...groupPresetsRef.current];
    newPresets[groupIdx] = presetId;
    groupPresetsRef.current = newPresets;
    setGroupPresets(newPresets);

    // If audio hasn't started yet, initAudio will pick up groupPresetsRef
    if (!masterLimiterRef.current) return;

    const key = `group_${groupIdx}`;
    const old = instrumentsRef.current[key];

    // Dispose old instrument nodes to avoid memory leaks
    if (old) {
      if (isDrumKit(old)) {
        old.kick.dispose();
        old.snare.dispose();
        old.hhClosed.dispose();
        old.hhOpen.dispose();
        old.volume.dispose();
      } else if (isChainInstrument(old)) {
        old.synth.dispose();
        old.volume.dispose();
      } else {
        (old as Tone.PolySynth<Tone.Synth>).dispose();
      }
      delete instrumentsRef.current[key];
    }

    const newInst = await createGroupInstrument(
      groupIdx,
      presetId,
      isMuted ? -Infinity : volume,
      masterLimiterRef.current
    );
    instrumentsRef.current[key] = newInst;
  }, [volume, isMuted]);

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
        const instruments = instrumentsRef.current;
        const agreement = activeAgreementRef.current;

        for (let row = 0; row < ROWS; row++) {
          if (!g[row][step]) continue;
          const inst = instruments[`group_${Math.floor(row / 4)}`] ?? instruments.default;
          if (!inst) continue;
          const baseVelocity = Math.max(0.05, Math.min(1, vg[row]?.[step] ?? 0.8));
          const velocity = Math.max(0.05, Math.min(1, baseVelocity * getAccentMultiplier(step, agreement?.accentPattern)));
          const length = lg[row]?.[step] || agreement?.noteLength || "16n";
          const note = NOTE_NAMES[row];

          if (isDrumKit(inst)) {
            // Route to the correct percussive synth based on position within the drum section
            const drumRow = row % 4; // 0=kick, 1=snare, 2=closed HH, 3=open HH
            switch (drumRow) {
              case 0: inst.kick.triggerAttackRelease(note, length, time, velocity); break;
              case 1: inst.snare.triggerAttackRelease(length, time, velocity); break;
              case 2: inst.hhClosed.triggerAttackRelease("16n", time, velocity); break;
              case 3: inst.hhOpen.triggerAttackRelease("8n", time, velocity); break;
            }
          } else {
            const synth = isChainInstrument(inst) ? inst.synth : inst;
            synth.triggerAttackRelease(note, length, time, velocity);
          }
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
    for (const key of ["group_0", "group_1", "group_2", "group_3"]) {
      const inst = instruments[key];
      if (!inst) continue;
      if (isDrumKit(inst)) {
        inst.volume.volume.value = v;
      } else if (isChainInstrument(inst)) {
        inst.volume.volume.value = v;
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
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header + Controls — single row */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-3 mb-4"
        >
          {/* Title */}
          <div className="mr-2">
            <h1 className="text-base font-semibold tracking-tight text-foreground leading-none mb-0.5">
              Music Agents
            </h1>
            <p className="text-muted-foreground text-[10px] tracking-[0.2em] uppercase leading-none" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              AI-Agent Live Sequencer
            </p>
          </div>

          <div className="w-px h-8 bg-border/50 hidden sm:block" />
          <Button
            onClick={isPlaying ? handleStop : handlePlay}
            className="gap-2 font-medium tracking-wide"
            size="default"
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

        {/* Agents — full width */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mb-4"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Agents
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

        {/* 2-column layout: grid + chat, same height */}
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 lg:h-[calc(100vh-14rem)]">
          {/* Left column: grid + status */}
          <div className="flex flex-col min-h-0">
            {/* Grid — 16 rows × 16 steps */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="flex-1 border border-border/60 rounded-md bg-card/40 p-2 md:p-3 overflow-auto min-h-0"
            >
              <div className="min-w-[680px]">
                {/* Step number header — aligns with cells below */}
                <div className="flex gap-2 items-center mb-2">
                  <div className="w-14 shrink-0" />
                  <div className="flex items-center gap-1 flex-1">
                    <div className="w-8 shrink-0" />
                    {Array.from({ length: STEPS }, (_, i) => (
                      <div
                        key={i}
                        className={`flex-1 text-center text-[8px] font-medium ${currentStep === i && isPlaying
                            ? "text-accent"
                            : i % 4 === 0
                              ? "text-muted-foreground/60"
                              : "text-muted-foreground/25"
                          }`}
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {i % 4 === 0 ? i + 1 : "·"}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Instrument groups */}
                {([0, 1, 2, 3] as const).map((groupIdx) => {
                  const info = GROUP_INFO[groupIdx];
                  const currentPreset = groupPresets[groupIdx];
                  const startRow = groupIdx * 4;
                  return (
                    <div key={groupIdx} className={groupIdx > 0 ? "mt-2.5" : ""}>
                      {groupIdx > 0 && (
                        <div className="h-px mb-2 opacity-15 bg-border" />
                      )}
                      <div className="flex items-stretch gap-2">
                        {/* Instrument selector panel */}
                        <div
                          className="w-14 shrink-0 flex flex-col rounded border overflow-hidden"
                          style={{ borderColor: info.color + "30" }}
                        >
                          <div
                            className="text-center px-1 py-1.5"
                            style={{ backgroundColor: info.color + "15" }}
                          >
                            <span
                              className="text-[8px] font-bold tracking-[0.18em]"
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                color: info.color,
                              }}
                            >
                              {info.name}
                            </span>
                          </div>
                          <div className="flex-1 flex flex-col justify-evenly gap-0.5 p-1">
                            {info.presets.map((preset) => {
                              const isActive = currentPreset === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  onClick={() => switchGroupPreset(groupIdx, preset.id)}
                                  className={`text-[9px] w-full rounded px-1 py-[3px] tracking-wider transition-all font-medium ${isActive ? "" : "hover:opacity-80"
                                    }`}
                                  style={{
                                    fontFamily: "'JetBrains Mono', monospace",
                                    color: isActive ? "hsl(var(--background))" : info.color,
                                    backgroundColor: isActive ? info.color : "transparent",
                                    opacity: isActive ? 1 : 0.5,
                                  }}
                                >
                                  {preset.short}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 4 sequencer rows */}
                        <div className="flex-1">
                          {([0, 1, 2, 3] as const).map((subRow) => {
                            const rowIdx = startRow + subRow;
                            const row = grid[rowIdx];
                            const owner = getRowOwner(rowIdx);
                            const cellColor = owner?.color || info.color;
                            return (
                              <div key={rowIdx} className="flex items-center gap-1 mb-1">
                                <span
                                  className="w-8 text-[10px] font-medium tracking-wider text-right pr-2 shrink-0"
                                  style={{
                                    fontFamily: "'JetBrains Mono', monospace",
                                    color: cellColor,
                                    opacity: owner ? 1 : 0.38,
                                  }}
                                >
                                  {ROW_LABELS[rowIdx]}
                                </span>
                                {row.map((active, colIdx) => {
                                  const isCurrentStep = currentStep === colIdx && isPlaying;
                                  const isBeat = colIdx % 4 === 0;
                                  return (
                                    <div
                                      key={colIdx}
                                      className={`
                                        flex-1 aspect-square transition-all duration-75 border
                                        ${active
                                          ? "grid-cell-active"
                                          : isBeat
                                            ? "bg-muted/50 border-border/50"
                                            : "bg-muted/25 border-border/25"
                                        }
                                        ${isCurrentStep && active ? "grid-cell-playing" : ""}
                                        ${isCurrentStep && !active ? "bg-accent/[0.06] border-accent/20" : ""}
                                      `}
                                      style={
                                        active
                                          ? {
                                            backgroundColor: cellColor + "38",
                                            borderColor: cellColor + "bb",
                                          }
                                          : undefined
                                      }
                                    />
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            {/* Status bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-3 shrink-0 flex items-center justify-between text-xs text-muted-foreground border border-border/50 rounded px-4 py-2 bg-card/20"
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
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
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
              <span className="tracking-widest text-[10px] text-muted-foreground/60" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                OBSERVER MODE
              </span>
            </motion.div>
          </div>

          {/* Right column: discussion */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="h-full min-h-0"
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
