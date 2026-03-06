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
  onDeactivateAgent: (personality: string) => void;
};

const AgentPanel = ({ connectedAgents, onActivateAgent, onDeactivateAgent }: AgentPanelProps) => {
  const connectedNames = new Set(connectedAgents.map((a) => a.name));

  return (
    <div className="flex flex-wrap gap-2">
      {AGENT_PERSONALITIES.map((p) => {
        const isConnected = connectedNames.has(p.name);
        return (
          <Button
            key={p.name}
            onClick={() => isConnected ? onDeactivateAgent(p.personality) : onActivateAgent(p.personality)}
            variant={isConnected ? "destructive" : "outline"}
            size="sm"
            className="text-[10px] tracking-wider gap-1.5 border-border hover:border-current transition-colors"
            style={{ color: isConnected ? undefined : p.color, opacity: 1 }}
            title={p.description}
          >
            <Bot className="w-3 h-3" />
            {isConnected ? `REMOVE ${p.name}` : p.name}
          </Button>
        );
      })}
    </div>
  );
};

export default AgentPanel;
