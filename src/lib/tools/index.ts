// OWNED BY TRACK B. Track A calls `tools[name](input, ctx)` from the Vapi webhook.
//
// Every handler below is a MOCK that returns contract-shaped data matching the seed,
// so Track A can run real calls before the database work lands. Track B replaces
// each mock with the real implementation (one tool at a time is fine) and deletes
// the "MOCK" comment when done.
import type { ToolHandlers } from "./types";
import { startDispatcherCall } from "@/lib/vapi";

export const tools: ToolHandlers = {
  // MOCK
  async lookup_tenant(_input, ctx) {
    console.log("[mock] lookup_tenant", ctx.callerPhone);
    return { found: true, tenant_name: "Tadiwa", unit: "3B", building: "Building B", language: "en" };
  },

  // MOCK
  async get_building_context(input) {
    return {
      similar_recent: [
        { unit: "4B", issue_type: input.issue_type, summary: "Bathroom leak under the bathtub", days_ago: 6 },
        { unit: "2B", issue_type: input.issue_type, summary: "Water stain on the kitchen ceiling", days_ago: 3 },
      ],
      pattern: true,
      pattern_note:
        "This is the third leak report in stack B this month. 4B above reported a bathroom leak last week, so the plumber should go to 4B first.",
      visit_first: "4B",
    };
  },

  // MOCK
  async create_ticket(input) {
    console.log("[mock] create_ticket", input);
    return { ticket_id: 1007, pattern: true, visit_first: "4B" };
  },

  // MOCK
  async send_photo_link(input) {
    console.log("[mock] send_photo_link", input);
    return { sent: true, message: "Photo link sent by SMS." };
  },

  // MOCK
  async check_photo() {
    return {
      uploaded: true,
      assessment: "Water stain about 40 cm wide on the ceiling, spreading towards the light fixture.",
      urgency: "urgent",
      safety_advice: "Please switch off the circuit for that light at your fuse box and don't touch the fixture.",
    };
  },

  // MOCK (but already calls Track A's dispatcher, so the outbound call can be tested early)
  async dispatch_contractor(input) {
    await startDispatcherCall({
      ticketId: input.ticket_id,
      contractorName: "Jan",
      contractorPhone: process.env.MOCK_CONTRACTOR_PHONE ?? "+490000000100",
      language: "en",
      trade: input.trade,
      building: "Building B",
      address: "Kaiserswerther Str. 120, Düsseldorf",
      unit: "3B",
      visitFirst: "4B",
      urgency: "urgent",
      issueSummary: "Water dripping from the ceiling near a light fixture.",
      patternNote: "Third leak in stack B this month; 4B above reported a bathroom leak last week.",
      slots: [
        { id: 1, startsAt: new Date(Date.now() + 2 * 3600e3).toISOString(), endsAt: new Date(Date.now() + 4 * 3600e3).toISOString() },
        { id: 2, startsAt: new Date(Date.now() + 5 * 3600e3).toISOString(), endsAt: new Date(Date.now() + 7 * 3600e3).toISOString() },
      ],
    });
    return { started: true, contractor_name: "Jan", message: "Calling Jan the plumber now." };
  },

  // MOCK
  async confirm_slot(input) {
    console.log("[mock] confirm_slot", input);
    return {
      confirmed: true,
      scheduled_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
      tenant_sms_sent: true,
      message: "Slot booked and the tenant has been texted.",
    };
  },
};
