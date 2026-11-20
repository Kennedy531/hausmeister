// Vapi function-tool definitions for both agents. Mirrors src/lib/contract.ts:
// change the contract first, then these (and src/app/api/vapi/validate.ts).

const ISSUE = ["leak", "heating", "electrical", "lock", "appliance", "pest", "other"];
const URGENCY = ["emergency", "urgent", "normal"];
const TRADE = ["plumber", "electrician", "locksmith", "handyman"];

const DEFINITIONS = {
  lookup_tenant: {
    description:
      "Look up the caller by their phone number. Only needed if the caller was not recognised at the start of the call.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  get_building_context: {
    description:
      "Check the building's recent history for similar problems in the same stack of flats. Returns recent similar tickets, whether there is a pattern, a sentence about it, and which flat the contractor should visit first.",
    parameters: {
      type: "object",
      properties: {
        unit: { type: "string", description: "The caller's flat, e.g. 3B" },
        issue_type: { type: "string", enum: ISSUE },
      },
      required: ["unit", "issue_type"],
    },
    filler: "One moment, I'm checking your building's history.",
  },
  create_ticket: {
    description: "Log the problem as a maintenance ticket. Returns the ticket_id needed for the other tools.",
    parameters: {
      type: "object",
      properties: {
        unit: { type: "string", description: "The caller's flat, e.g. 3B" },
        issue_type: { type: "string", enum: ISSUE },
        urgency: { type: "string", enum: URGENCY },
        summary: { type: "string", description: "One sentence in English describing the problem" },
      },
      required: ["unit", "issue_type", "urgency", "summary"],
    },
  },
  send_photo_link: {
    description: "Text the caller a link where they can upload a photo of the damage.",
    parameters: {
      type: "object",
      properties: { ticket_id: { type: "integer" } },
      required: ["ticket_id"],
    },
  },
  check_photo: {
    description: "Check whether the caller has uploaded their photo, and get an assessment of it.",
    parameters: {
      type: "object",
      properties: { ticket_id: { type: "integer" } },
      required: ["ticket_id"],
    },
  },
  dispatch_contractor: {
    description:
      "Start a phone call to the best available contractor for this trade, who will be offered time slots. Returns the contractor's name.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: { type: "integer" },
        trade: { type: "string", enum: TRADE },
      },
      required: ["ticket_id", "trade"],
    },
    filler: "Let me get the right person on the phone.",
  },
  confirm_slot: {
    description: "Book the slot the contractor accepted. This also texts the tenant the confirmed time.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: { type: "integer" },
        slot_id: { type: "integer", description: "The id of the slot the contractor accepted" },
      },
      required: ["ticket_id", "slot_id"],
    },
  },
};

/**
 * Builds Vapi tool definitions for the named tools, all pointing at our webhook.
 * @param {string[]} names
 * @param {{ url: string, credentialId?: string }} server
 */
export function functionTools(names, server) {
  return names.map((name) => {
    const def = DEFINITIONS[name];
    if (!def) throw new Error(`Unknown tool ${name}`);
    const tool = {
      type: "function",
      function: { name, description: def.description, parameters: def.parameters },
      server,
      messages: [
        {
          type: "request-failed",
          content: "Sorry, I couldn't reach our system just now. Someone from the property team will follow up with you today.",
        },
      ],
    };
    if (def.filler) tool.messages.unshift({ type: "request-start", content: def.filler });
    return tool;
  });
}
