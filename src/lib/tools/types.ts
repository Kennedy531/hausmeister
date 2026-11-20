// SHARED SEAM — change only after both tracks agree (see docs/TRACKS.md).
import type { ToolContract, ToolName } from "@/lib/contract";

/** What the backend knows about the call a tool was invoked from. Filled in by the Vapi webhook (Track A). */
export interface ToolContext {
  /** Caller's number in E.164 (tenant on inbound calls, contractor on dispatcher calls). */
  callerPhone: string | null;
  callId: string | null;
  /** ISO time the call started, used for the dashboard's call-to-booked timer. */
  callStartedAt: string | null;
}

/** One handler per tool. Implemented by Track B in src/lib/tools/index.ts. */
export type ToolHandlers = {
  [K in ToolName]: (
    input: ToolContract[K]["input"],
    ctx: ToolContext,
  ) => Promise<ToolContract[K]["output"]>;
};
