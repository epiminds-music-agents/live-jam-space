import { useEffect, useRef, useCallback, useState } from 'react';

export type AgentScope = {
  agentId: string;
  name: string;
  color: string;
  description: string;
  scopeStart: number;
  scopeEnd: number;
};

export type PendingActivation = {
  agentId: string;
  personality: string;
  requestedAt: number;
};

export type SongAgreement = {
  id: string;
  section: string;
  density: string;
  interaction: string;
  pulseBias: string;
  holdBars: number;
  swing?: number;
  noteLength?: string;
  accentPattern?: string;
  roles?: Array<{
    agent: string;
    task: string;
  }>;
  rosterSignature?: string;
  proposedBy?: string;
  createdAt?: number;
  bpmAtCreation?: number;
};

export type AgentMessage = {
  agentId: string;
  name: string;
  color: string;
  kind?: 'chat' | 'note' | 'plan';
  agreement?: SongAgreement;
  text: string;
  timestamp: number;
};

export type SyncState = {
  grid: boolean[][];
  velocityGrid: number[][];
  lengthGrid: string[][];
  bpm: number;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
};

type SyncCallbacks = {
  onInit: (
    state: SyncState,
    agents: AgentScope[],
    discussion: AgentMessage[],
    pendingActivations: PendingActivation[]
  ) => void;
  onCellToggle: (row: number, step: number, value: boolean, velocity?: number, length?: string) => void;
  onBpmChange: (bpm: number) => void;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (isMuted: boolean) => void;
  onPlayStateChange: (isPlaying: boolean) => void;
  onScopeUpdate: (agents: AgentScope[]) => void;
  onActivationUpdate: (pendingActivations: PendingActivation[]) => void;
  onAgentMessage: (message: AgentMessage) => void;
  onResetDiscussion: () => void;
};

export function useSync(callbacks: SyncCallbacks) {
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  const [connectedUsers, setConnectedUsers] = useState(1);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => console.log('[Sync] Connected');
    ws.onclose = () => console.log('[Sync] Disconnected');
    ws.onerror = (e) => console.error('[Sync] Error', e);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      const cb = callbacksRef.current;
      switch (msg.type) {
        case 'init':
          setConnectedUsers(msg.users);
          cb.onInit(
            msg.state,
            msg.agents || [],
            msg.discussion || [],
            msg.pendingActivations || []
          );
          break;
        case 'users':
          setConnectedUsers(msg.count);
          break;
        case 'cell_toggle':
          cb.onCellToggle(msg.row, msg.step, msg.value, msg.velocity, msg.length);
          break;
        case 'bpm_change':
          cb.onBpmChange(msg.bpm);
          break;
        case 'volume_change':
          cb.onVolumeChange(msg.volume);
          break;
        case 'muted_change':
          cb.onMutedChange(msg.isMuted);
          break;
        case 'play_state':
          cb.onPlayStateChange(msg.isPlaying);
          break;
        case 'scope_update':
          cb.onScopeUpdate(msg.agents);
          break;
        case 'activation_update':
          cb.onActivationUpdate(msg.pendingActivations || []);
          break;
        case 'agent_message':
          cb.onAgentMessage(msg.message);
          break;
        case 'reset_discussion':
          cb.onResetDiscussion();
          break;
      }
    };

    return () => ws.close();
  }, []);

  const send = useCallback(<T extends object>(action: T) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }, []);

  return { send, connectedUsers };
}
