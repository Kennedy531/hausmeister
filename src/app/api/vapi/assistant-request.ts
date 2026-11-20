// Inbound calls: the Vapi phone number has no fixed assistant, so Vapi asks us which
// assistant to use (an "assistant-request"). We recognise the caller by phone number and
// hand back the tenant assistant with their name, flat and language filled in, so the
// first sentence can already be "Hi Tadiwa, is this about apartment 3B?".
// Vapi gives us 7.5 seconds in total, so the lookup is capped well below that.
import { tools } from "@/lib/tools";
import type { LookupTenantOutput } from "@/lib/contract";
import { contextFrom, type VapiMessage } from "./message";

const LOOKUP_TIMEOUT_MS = 3000;

type AssistantRequestReply =
  | { assistantId: string; assistantOverrides: { variableValues: Record<string, string> } }
  | { error: string };

function greetingFor(tenant: Extract<LookupTenantOutput, { found: true }>): string {
  const firstName = tenant.tenant_name.split(" ")[0];
  return tenant.language === "de"
    ? `Hallo ${firstName}, hier ist Hausmeister. Geht es um Ihre Wohnung ${tenant.unit} in ${tenant.building}?`
    : `Hi ${firstName}, this is Hausmeister. Is this about your flat in ${tenant.building}, apartment ${tenant.unit}?`;
}

async function lookupWithTimeout(message: VapiMessage): Promise<LookupTenantOutput | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS));
  const lookup = tools.lookup_tenant({}, contextFrom(message)).catch((err) => {
    console.error("[vapi] assistant-request lookup failed", err);
    return null;
  });
  return Promise.race([lookup, timeout]);
}

export async function replyToAssistantRequest(message: VapiMessage): Promise<AssistantRequestReply> {
  const assistantId = process.env.VAPI_TENANT_ASSISTANT_ID;
  if (!assistantId) {
    console.error("[vapi] VAPI_TENANT_ASSISTANT_ID is not set");
    return { error: "Sorry, this line isn't set up yet. Please try again later." };
  }

  const tenant = await lookupWithTimeout(message);
  const variableValues: Record<string, string> =
    tenant?.found
      ? {
          known_caller: "yes",
          tenant_name: tenant.tenant_name,
          unit: tenant.unit,
          building: tenant.building,
          language: tenant.language,
          greeting: greetingFor(tenant),
        }
      : {
          known_caller: "no",
          language: "en",
          greeting: "Hi, this is Hausmeister, the caretaker line. Who am I speaking with, and which flat are you in?",
        };

  console.log(`[vapi] assistant-request: known_caller=${variableValues.known_caller}`);
  return { assistantId, assistantOverrides: { variableValues } };
}
