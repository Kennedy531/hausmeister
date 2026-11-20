// Light runtime checks on the arguments the LLM sends, so a bad call comes back to the
// agent as a clear error it can retry, instead of reaching the database.
// Mirrors src/lib/contract.ts: if the contract changes, update this too.
import type { ToolName } from "@/lib/contract";

type Spec = "string" | "number" | readonly string[];

const ISSUE = ["leak", "heating", "electrical", "lock", "appliance", "pest", "other"] as const;
const URGENCY = ["emergency", "urgent", "normal"] as const;
const TRADE = ["plumber", "electrician", "locksmith", "handyman"] as const;

const SCHEMA: Record<ToolName, Record<string, Spec>> = {
  lookup_tenant: {},
  get_building_context: { unit: "string", issue_type: ISSUE },
  create_ticket: { unit: "string", issue_type: ISSUE, urgency: URGENCY, summary: "string" },
  send_photo_link: { ticket_id: "number" },
  check_photo: { ticket_id: "number" },
  dispatch_contractor: { ticket_id: "number", trade: TRADE },
  confirm_slot: { ticket_id: "number", slot_id: "number" },
};

export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && Object.hasOwn(SCHEMA, name);
}

/** Returns cleaned arguments, or an error message for the agent. */
export function validateArgs(
  tool: ToolName,
  raw: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  let obj: unknown = raw ?? {};
  if (typeof obj === "string") {
    try {
      obj = obj.trim() ? JSON.parse(obj) : {};
    } catch {
      return { ok: false, error: `${tool}: arguments are not valid JSON` };
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, error: `${tool}: arguments must be an object` };
  }

  const input = obj as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [field, spec] of Object.entries(SCHEMA[tool])) {
    const value = input[field];
    if (spec === "number") {
      // LLMs often send ids as strings ("1007").
      const n = typeof value === "string" ? Number(value.trim()) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) problems.push(`${field} must be a whole number`);
      else args[field] = n;
    } else if (spec === "string") {
      if (typeof value !== "string" || !value.trim()) problems.push(`${field} is required`);
      // Unit labels are stored upper case ("3B").
      else args[field] = field === "unit" ? value.trim().toUpperCase() : value.trim();
    } else {
      const v = typeof value === "string" ? value.trim().toLowerCase() : value;
      if (typeof v !== "string" || !spec.includes(v)) problems.push(`${field} must be one of: ${spec.join(", ")}`);
      else args[field] = v;
    }
  }

  return problems.length ? { ok: false, error: `${tool}: ${problems.join("; ")}` } : { ok: true, args };
}
