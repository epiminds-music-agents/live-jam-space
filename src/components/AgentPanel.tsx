import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AgentPersonality = {
  id: string;
  name: string;
  color: string;
  description: string;
  pattern: (rows: number, steps: number) => boolean[][];
};

const PERSONALITIES: Omit<AgentPersonality, "id">[] = [
  {
    name: "PULSE",
    color: "hsl(180, 100%, 50%)",
    description: "Steady 4-on-the-floor kicks",
    pattern: (rows, steps) =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: steps }, (_, c) =>
          r === rows - 1 && c % 4 === 0
        )
      ),
  },
  {
    name: "GHOST",
    color: "hsl(300, 100%, 60%)",
    description: "Sparse, random high notes",
    pattern: (rows, steps) =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: steps }, () =>
          r < 2 && Math.random() > 0.85
        )
      ),
  },
  {
    name: "CHAOS",
    color: "hsl(120, 100%, 50%)",
    description: "Wild random bursts everywhere",
    pattern: (rows, steps) =>
      Array.from({ length: rows }, () =>
        Array.from({ length: steps }, () => Math.random() > 0.7)
      ),
  },
  {
    name: "WAVE",
    color: "hsl(45, 100%, 55%)",
    description: "Ascending arpeggio patterns",
    pattern: (rows, steps) =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: steps }, (_, c) => c % rows === r)
      ),
  },
  {
    name: "DRILL",
    color: "hsl(0, 84%, 60%)",
    description: "Fast stuttery rhythms on mids",
    pattern: (rows, steps) =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: steps }, (_, c) =>
          r >= 2 && r <= 4 && (c % 2 === 0 || Math.random() > 0.6)
        )
      ),
  },
];

export type ActiveAgent = {
  id: string;
  personality: Omit<AgentPersonality, "id">;
  pattern: boolean[][];
};

type AgentPanelProps = {
  agents: ActiveAgent[];
  onAddAgent: (personality: Omit<AgentPersonality, "id">) => void;
  onRemoveAgent: (id: string) => void;
  rows: number;
  steps: number;
};

const AgentPanel = ({ agents, onAddAgent, onRemoveAgent }: AgentPanelProps) => {
  return (
    <div className="space-y-3">
      {/* Active Agents */}
      <div className="flex flex-wrap gap-2">
        <AnimatePresence>
          {agents.map((agent) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-2 bg-card/60 border border-border rounded px-3 py-1.5"
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: agent.personality.color }}
              />
              <span
                className="text-xs font-bold tracking-wider"
                style={{ fontFamily: "Orbitron, monospace", color: agent.personality.color }}
              >
                {agent.personality.name}
              </span>
              <button
                onClick={() => onRemoveAgent(agent.id)}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add Agent Buttons */}
      <div className="flex flex-wrap gap-2">
        {PERSONALITIES.map((p) => (
          <Button
            key={p.name}
            onClick={() => onAddAgent(p)}
            variant="outline"
            size="sm"
            className="text-[10px] tracking-wider gap-1.5 border-border hover:border-current transition-colors"
            style={{ color: p.color }}
            title={p.description}
          >
            <Plus className="w-3 h-3" />
            {p.name}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default AgentPanel;
