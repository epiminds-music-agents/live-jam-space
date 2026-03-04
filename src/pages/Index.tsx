import { useState, useCallback, useRef, useEffect } from "react";
import * as Tone from "tone";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Square, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const STEPS = 16;
const ROWS = 6;
const NOTE_NAMES = ["C5", "A4", "F4", "D4", "A3", "D3"];
const ROW_LABELS = ["HI", "MH", "MD", "ML", "LO", "SUB"];

type Grid = boolean[][];

const createEmptyGrid = (): Grid =>
  Array.from({ length: ROWS }, () => Array(STEPS).fill(false));

const Index = () => {
  const [grid, setGrid] = useState<Grid>(createEmptyGrid);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm, setBpm] = useState(120);
  const [volume, setVolume] = useState(-6);
  const [isMuted, setIsMuted] = useState(false);

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const sequenceRef = useRef<Tone.Sequence | null>(null);
  const gridRef = useRef(grid);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  const initAudio = useCallback(async () => {
    if (!synthRef.current) {
      await Tone.start();
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle8" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.3 },
      }).toDestination();
      synth.volume.value = volume;
      synthRef.current = synth;
    }
  }, [volume]);

  const toggleCell = useCallback((row: number, col: number) => {
    setGrid((prev) => {
      const next = prev.map((r) => [...r]);
      next[row][col] = !next[row][col];
      return next;
    });
  }, []);

  const startSequencer = useCallback(async () => {
    await initAudio();
    if (!synthRef.current) return;

    Tone.getTransport().bpm.value = bpm;

    if (sequenceRef.current) {
      sequenceRef.current.dispose();
    }

    const seq = new Tone.Sequence(
      (time, step) => {
        setCurrentStep(step);
        const g = gridRef.current;
        const notes: string[] = [];
        for (let row = 0; row < ROWS; row++) {
          if (g[row][step]) notes.push(NOTE_NAMES[row]);
        }
        if (notes.length > 0 && synthRef.current) {
          synthRef.current.triggerAttackRelease(notes, "16n", time);
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
    }
  }, [bpm, isPlaying]);

  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.volume.value = isMuted ? -Infinity : volume;
    }
  }, [volume, isMuted]);

  const clearGrid = useCallback(() => {
    setGrid(createEmptyGrid());
  }, []);

  const randomize = useCallback(() => {
    setGrid(
      Array.from({ length: ROWS }, () =>
        Array.from({ length: STEPS }, () => Math.random() > 0.75)
      )
    );
  }, []);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Scanline overlay */}
      <div className="scanline fixed inset-0 z-50" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8">
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
            GRID_SYNTH
          </h1>
          <p className="text-muted-foreground text-sm tracking-[0.3em] uppercase">
            collaborative step sequencer
          </p>
        </motion.div>

        {/* Controls */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-wrap items-center justify-center gap-3 mb-6"
        >
          <Button
            onClick={isPlaying ? stopSequencer : startSequencer}
            className="gap-2 font-bold tracking-wider border border-primary bg-primary/10 text-primary hover:bg-primary/20"
            size="lg"
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? "STOP" : "PLAY"}
          </Button>

          <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 border border-border">
            <span className="text-xs text-muted-foreground w-8">BPM</span>
            <Slider
              value={[bpm]}
              onValueChange={([v]) => setBpm(v)}
              min={60}
              max={200}
              step={1}
              className="w-28"
            />
            <span className="text-primary text-sm font-bold w-8">{bpm}</span>
          </div>

          <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 border border-border">
            <button onClick={() => setIsMuted(!isMuted)} className="text-muted-foreground hover:text-primary">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <Slider
              value={[volume]}
              onValueChange={([v]) => setVolume(v)}
              min={-30}
              max={0}
              step={1}
              className="w-20"
            />
          </div>

          <Button onClick={randomize} variant="outline" size="sm" className="text-xs tracking-wider border-secondary text-secondary hover:bg-secondary/10">
            RND
          </Button>
          <Button onClick={clearGrid} variant="outline" size="sm" className="text-xs tracking-wider border-destructive text-destructive hover:bg-destructive/10">
            CLR
          </Button>
        </motion.div>

        {/* Grid */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="border border-border rounded-lg bg-card/50 p-3 md:p-4 overflow-x-auto"
        >
          <div className="min-w-[640px]">
            {grid.map((row, rowIdx) => (
              <div key={rowIdx} className="flex items-center gap-1 mb-1">
                <span
                  className="w-10 text-[10px] font-bold tracking-wider text-muted-foreground text-right pr-2 shrink-0"
                  style={{ fontFamily: "Orbitron, monospace" }}
                >
                  {ROW_LABELS[rowIdx]}
                </span>
                {row.map((active, colIdx) => {
                  const isCurrentStep = currentStep === colIdx && isPlaying;
                  const isBeat = colIdx % 4 === 0;
                  return (
                    <button
                      key={colIdx}
                      onClick={() => toggleCell(rowIdx, colIdx)}
                      className={`
                        flex-1 aspect-square rounded-sm transition-all duration-75 border
                        ${active
                          ? "bg-primary/80 border-primary grid-cell-active"
                          : isBeat
                            ? "bg-muted/60 border-border/60 hover:bg-muted"
                            : "bg-muted/30 border-border/30 hover:bg-muted/50"
                        }
                        ${isCurrentStep && active ? "grid-cell-playing bg-secondary border-secondary" : ""}
                        ${isCurrentStep && !active ? "border-secondary/40" : ""}
                      `}
                    />
                  );
                })}
              </div>
            ))}

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

        {/* Agents / Status bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 flex items-center justify-between text-xs text-muted-foreground border border-border rounded px-4 py-2 bg-card/30"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span>1 agent connected</span>
          </div>
          <span className="tracking-widest" style={{ fontFamily: "Orbitron, monospace" }}>
            LOCAL MODE
          </span>
        </motion.div>
      </div>
    </div>
  );
};

export default Index;
