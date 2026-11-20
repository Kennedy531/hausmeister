// The parts of Vapi's server messages this app reads.
import type { ToolContext } from "@/lib/tools/types";

export interface VapiToolCall {
  id: string;
  function?: { name?: string; arguments?: unknown };
}

export interface VapiMessage {
  type?: string;
  timestamp?: number;
  customer?: { number?: string };
  call?: { id?: string; startedAt?: string; createdAt?: string; customer?: { number?: string } };
  toolCallList?: VapiToolCall[];
}

export function contextFrom(message: VapiMessage): ToolContext {
  const callStartedAt =
    message.call?.startedAt ??
    message.call?.createdAt ??
    (message.timestamp ? new Date(message.timestamp).toISOString() : null);
  return {
    // Inbound: the tenant. Outbound (dispatcher): the contractor.
    callerPhone: message.customer?.number ?? message.call?.customer?.number ?? null,
    callId: message.call?.id ?? null,
    callStartedAt,
  };
}
