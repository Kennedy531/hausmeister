// OWNED BY TRACK B. Used for the photo link, the tenant's booking confirmation and emergency alerts.

/**
 * Sends an SMS.
 * STUB: logs only. Track B replaces this with a Twilio REST call
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER) using fetch, no SDK needed.
 */
export async function sendSms(to: string, body: string): Promise<{ sent: boolean }> {
  console.log("[stub] sendSms", to, body);
  return { sent: true };
}
