import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentScope } from "@/hooks/useSync";

export const AGENT_PERSONALITIES = [
  { personality: "PULSE", name: "PULSE", color: "hsl(180, 60%, 55%)", description: "Steady 4-on-the-floor kicks" },
  { personality: "GHOST", name: "GHOST", color: "hsl(285, 55%, 65%)", description: "Sparse, random high notes" },
  { personality: "CHAOS", name: "CHAOS", color: "hsl(142, 50%, 55%)", description: "Wild random bursts everywhere" },
  { personality: "WAVE", name: "WAVE", color: "hsl(35, 80%, 58%)", description: "Ascending arpeggio patterns" },
];

type AgentPanelProps = {
  connectedAgents: AgentScope[];
  pendingAgents: string[];
  onActivateAgent: (personality: string) => void;
  onDeactivateAgent: (personality: string) => void;
};

const AgentPanel = ({
  connectedAgents,
  pendingAgents,
  onActivateAgent,
  onDeactivateAgent,
}: AgentPanelProps) => {
  const connectedNames = new Set(connectedAgents.map((a) => a.name));
  const pendingNames = new Set(pendingAgents.map((name) => name.toUpperCase()));

  return (
    <div className="flex flex-wrap gap-2">
      {AGENT_PERSONALITIES.map((p) => {
        const isConnected = connectedNames.has(p.name);
        const isPending = !isConnected && pendingNames.has(p.name);
        return (
          <Button
            key={p.name}
            onClick={() => {
              if (isPending) return;
              if (isConnected) onDeactivateAgent(p.personality);
              else onActivateAgent(p.personality);
            }}
            variant={isConnected ? "destructive" : isPending ? "secondary" : "outline"}
            size="sm"
            className="text-[10px] tracking-wider gap-1.5 border-border/60 hover:border-current transition-colors font-medium"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
            disabled={isPending}
            style={{ color: isConnected || isPending ? undefined : p.color, opacity: isPending ? 0.8 : 1 }}
            title={p.description}
          >
            <Bot className="w-3 h-3" />
            {isConnected ? `REMOVE ${p.name}` : isPending ? `CONNECTING ${p.name}` : p.name}
          </Button>
        );
      })}
    </div>
  );
};

export default AgentPanel;
