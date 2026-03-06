import { useEffect, useRef, useCallback, useState } from 'react';

export type AgentScope = {
  agentId: string;
  name: string;
  color: string;
  description: string;
  scopeStart: number;
  scopeEnd: number;
};

export type AgentMessage = {
  agentId: string;
  name: string;
  color: string;
  text: string;
  timestamp: number;
};

export type SyncState = {
  grid: boolean[][];
  bpm: number;
  volume: number;
  isMuted: boolean;
  isPlaying: boolean;
};

type SyncCallbacks = {
  onInit: (state: SyncState, agents: AgentScope[], discussion: AgentMessage[]) => void;
  onCellToggle: (row: number, step: number, value: boolean) => void;
  onBpmChange: (bpm: number) => void;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (isMuted: boolean) => void;
  onPlayStateChange: (isPlaying: boolean) => void;
  onScopeUpdate: (agents: AgentScope[]) => void;
  onAgentMessage: (message: AgentMessage) => void;
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
          cb.onInit(msg.state, msg.agents || [], msg.discussion || []);
          break;
        case 'users':
          setConnectedUsers(msg.count);
          break;
        case 'cell_toggle':
          cb.onCellToggle(msg.row, msg.step, msg.value);
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
        case 'agent_message':
          cb.onAgentMessage(msg.message);
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
