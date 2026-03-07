import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentScope, AgentMessage } from "@/hooks/useSync";

type AgentDiscussionProps = {
  messages: AgentMessage[];
  agents: AgentScope[];
};

const AgentDiscussion = ({ messages, agents }: AgentDiscussionProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full border border-border rounded-lg bg-card/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
        <h2
          className="text-xs font-bold tracking-[0.3em] text-muted-foreground"
          style={{ fontFamily: "Orbitron, monospace" }}
        >
          AGENT DISCUSSION
        </h2>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-[10px] text-muted-foreground tracking-wider">LIVE</span>
        </span>
      </div>

      {/* Agent Roster */}
      {agents.length > 0 && (
        <div className="px-4 py-2 border-b border-border/50 space-y-1">
          {agents.map((agent) => (
            <div key={agent.agentId} className="flex items-center gap-2 text-xs">
              <span
                className="w-2 h-2 rounded-full animate-pulse shrink-0"
                style={{ backgroundColor: agent.color }}
              />
              <span
                className="font-bold tracking-wider"
                style={{ fontFamily: "Orbitron, monospace", color: agent.color }}
              >
                {agent.name}
              </span>
              <span className="text-muted-foreground">
                rows {agent.scopeStart}-{agent.scopeEnd}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-2">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs tracking-wider">
            Waiting for agents...
          </div>
        ) : (
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
                  className={`mb-3 rounded-md border px-3 py-2 ${toneClass}`}
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
                      style={{ fontFamily: "Orbitron, monospace", color: msg.color }}
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
        )}
        <div ref={bottomRef} />
      </ScrollArea>
    </div>
  );
};

export default AgentDiscussion;
