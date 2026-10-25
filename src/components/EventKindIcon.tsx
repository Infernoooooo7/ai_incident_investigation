import {
  Bot,
  CornerDownRight,
  Hourglass,
  MessageSquare,
  OctagonAlert,
  RotateCw,
  ShieldCheck,
  ShieldX,
  User,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentEvent, EventKind } from '../domain/types';

const KIND_ICONS: Record<EventKind, LucideIcon> = {
  agent_message: MessageSquare,
  tool_call: Wrench,
  tool_result: CornerDownRight,
  retry: RotateCw,
  error: OctagonAlert,
  permission_decision: ShieldCheck,
};

export function KindIcon({ kind, size = 16 }: { kind: EventKind; size?: number }) {
  const Icon = KIND_ICONS[kind];
  return <Icon size={size} />;
}

/** Icon for a specific event, refined by role, outcome, or decision. */
export function EventKindIcon({ event, size = 16 }: { event: AgentEvent; size?: number }) {
  let Icon = KIND_ICONS[event.kind];
  if (event.kind === 'agent_message' && event.role !== 'system') {
    Icon = event.role === 'user' ? User : Bot;
  } else if (event.kind === 'tool_result' && event.outcome === 'timeout') {
    Icon = Hourglass;
  } else if (event.kind === 'permission_decision' && event.decision === 'denied') {
    Icon = ShieldX;
  }
  return <Icon size={size} />;
}
