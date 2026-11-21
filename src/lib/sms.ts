// OWNED BY TRACK B. Used for the tenant's booking confirmation, the neighbour access text and emergency alerts.

/**
 * Sends an SMS through the Twilio REST API (no SDK).
 * Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID).
 * Without them it only logs and returns { sent: false }, so the rest of the loop keeps working.
 */
export async function sendSms(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !service)) {
    console.log("[sms not configured] would send to", to, ":", body);
    return { sent: false, error: "Twilio is not configured" };
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (service) form.set("MessagingServiceSid", service);
  else form.set("From", from!);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Twilio SMS failed", res.status, text);
      return { sent: false, error: `Twilio ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("Twilio SMS error", e);
    return { sent: false, error: String(e) };
  }
}
