import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentScope } from "@/hooks/useSync";

export const AGENT_PERSONALITIES = [
  { personality: "PULSE", name: "PULSE", color: "hsl(180, 100%, 50%)", description: "Steady 4-on-the-floor kicks" },
  { personality: "GHOST", name: "GHOST", color: "hsl(300, 100%, 60%)", description: "Sparse, random high notes" },
  { personality: "CHAOS", name: "CHAOS", color: "hsl(120, 100%, 50%)", description: "Wild random bursts everywhere" },
  { personality: "WAVE", name: "WAVE", color: "hsl(45, 100%, 55%)", description: "Ascending arpeggio patterns" },
];

type AgentPanelProps = {
  connectedAgents: AgentScope[];
  onActivateAgent: (personality: string) => void;
};

const AgentPanel = ({ connectedAgents, onActivateAgent }: AgentPanelProps) => {
  const connectedNames = new Set(connectedAgents.map((a) => a.name));

  return (
    <div className="flex flex-wrap gap-2">
      {AGENT_PERSONALITIES.map((p) => {
        const isConnected = connectedNames.has(p.name);
        return (
          <Button
            key={p.name}
            onClick={() => onActivateAgent(p.personality)}
            variant="outline"
            size="sm"
            disabled={isConnected}
            className="text-[10px] tracking-wider gap-1.5 border-border hover:border-current transition-colors"
            style={{ color: p.color, opacity: isConnected ? 0.4 : 1 }}
            title={p.description}
          >
            <Bot className="w-3 h-3" />
            {p.name}
            {isConnected && " (LIVE)"}
          </Button>
        );
      })}
    </div>
  );
};

export default AgentPanel;
