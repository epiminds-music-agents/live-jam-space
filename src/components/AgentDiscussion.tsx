import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AgentScope, AgentMessage } from "@/hooks/useSync";

const AGENT_CONFIGS = [
  { name: "PULSE", color: "hsl(180, 60%, 55%)", description: "Steady kick patterns" },
  { name: "GHOST", color: "hsl(285, 55%, 65%)", description: "Sparse high notes" },
  { name: "CHAOS", color: "hsl(142, 50%, 55%)", description: "Wild random bursts" },
  { name: "WAVE",  color: "hsl(35, 80%, 58%)",  description: "Ascending arpeggios" },
];

type AgentDiscussionProps = {
  messages: AgentMessage[];
  agents: AgentScope[];
  humanPrompt: string;
  onHumanPromptChange: (value: string) => void;
  onSendHumanPrompt: () => void;
};

const AgentDiscussion = ({
  messages,
  agents,
  humanPrompt,
  onHumanPromptChange,
  onSendHumanPrompt,
}: AgentDiscussionProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full border border-border/60 rounded-md bg-card/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 shrink-0">
        <h2 className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Agent Chat
        </h2>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] text-muted-foreground/60 tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>LIVE</span>
        </span>
      </div>

      {/* Messages / Empty State */}
      <ScrollArea className="flex-1 min-h-0">
        {messages.length === 0 ? (
          /* ── Swarm Status Visualization ── */
          <div className="flex flex-col justify-center h-full px-5 py-8 gap-6">
            {/* Agent track lanes */}
            <div className="space-y-5">
              <p className="text-[9px] tracking-[0.35em] text-muted-foreground/35 uppercase mb-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Swarm Status
              </p>
              {AGENT_CONFIGS.map((p, i) => {
                const isActive = agents.some((a) => a.name === p.name);
                const scope = agents.find((a) => a.name === p.name);
                return (
                  <div key={p.name} className="flex items-center gap-3">
                    {/* Pulse dot */}
                    <motion.div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                      animate={
                        isActive
                          ? { opacity: [0.5, 1, 0.5], scale: [0.85, 1.15, 0.85] }
                          : { opacity: 0.18 }
                      }
                      transition={{
                        repeat: Infinity,
                        duration: 1.9,
                        delay: i * 0.42,
                        ease: "easeInOut",
                      }}
                    />

                    {/* Name */}
                    <span
                      className="text-[10px] font-medium w-11 shrink-0"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color: isActive ? p.color : "hsl(var(--muted-foreground))",
                        opacity: isActive ? 1 : 0.3,
                      }}
                    >
                      {p.name}
                    </span>

                    {/* Track lane */}
                    <div className="flex-1 h-[3px] rounded-full bg-border/20 overflow-hidden relative">
                      {isActive && (
                        <motion.div
                          className="absolute top-0 h-full w-1/3 rounded-full"
                          style={{ backgroundColor: p.color }}
                          animate={{ x: ["calc(-100%)", "calc(300%)"] }}
                          transition={{
                            repeat: Infinity,
                            duration: 2.4,
                            ease: "linear",
                            delay: i * 0.6,
                          }}
                        />
                      )}
                    </div>

                    {/* Scope / status */}
                    <span
                      className="text-[9px] w-14 text-right shrink-0 tabular-nums"
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        color: isActive ? p.color : "hsl(var(--muted-foreground))",
                        opacity: isActive ? 0.65 : 0.2,
                      }}
                    >
                      {isActive && scope
                        ? `r${scope.scopeStart}–${scope.scopeEnd}`
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bottom hint */}
            <p
              className="text-[9px] text-muted-foreground/25 tracking-[0.25em] text-center uppercase mt-2"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {agents.length === 0 ? "activate agents above" : "listening…"}
            </p>
          </div>
        ) : (
          <div className="px-4 py-2">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => {
                const toneClass =
                  msg.kind === "plan"
                    ? "border-accent/50 bg-accent/10"
                    : msg.kind === "note"
                      ? "border-border/80 bg-accent/5"
                      : "border-transparent bg-transparent";
                const badge =
                  msg.kind === "plan"
                    ? "PLAN"
                    : msg.kind === "note"
                      ? "NOTE"
                      : null;

                return (
                  <motion.div
                    key={`${msg.agentId}-${msg.timestamp}-${i}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mb-2 rounded border px-3 py-2 ${toneClass}`}
                  >
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/60">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span
                        className="text-xs font-bold tracking-wider"
                        style={{ fontFamily: "'JetBrains Mono', monospace", color: msg.color }}
                      >
                        {msg.name}
                      </span>
                      {badge && (
                        <span className="text-[9px] font-bold tracking-[0.3em] text-muted-foreground/70">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p
                      className={`pl-0.5 leading-relaxed ${
                        msg.kind === "note" || msg.kind === "plan"
                          ? "text-xs tracking-[0.08em] text-foreground/70"
                          : "text-sm text-foreground/80"
                      }`}
                    >
                      {msg.text}
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Director Prompt */}
      <div className="border-t border-border bg-card/40 p-3 shrink-0">
        <div className="mb-2 text-[10px] tracking-[0.2em] text-muted-foreground/70 uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          Director Prompt
        </div>
        <div className="flex gap-2">
          <Input
            value={humanPrompt}
            onChange={(event) => onHumanPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSendHumanPrompt();
              }
            }}
            placeholder='e.g. "Swedish House Mafia", "darker and sparse", "big euphoric build"'
            className="h-9 text-sm"
          />
          <Button onClick={onSendHumanPrompt} className="h-9 shrink-0">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AgentDiscussion;
