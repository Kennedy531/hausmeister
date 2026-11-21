// Booking confirmation by email (the SMS route is blocked by the Twilio trial).
// Sends through Gmail with an app password:
//   GMAIL_USER            the Gmail address that sends
//   GMAIL_APP_PASSWORD    a 16-character Google app password (not the normal password)
//   CONFIRMATION_EMAIL_TO where tenant confirmations go during the demo (one demo tenant)
// Without them it only logs and returns { sent: false }, so the call flow never breaks.
import nodemailer from "nodemailer";

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/** Where the tenant's confirmation goes. Demo: one fixed inbox. */
export function tenantEmailAddress(): string | null {
  return process.env.CONFIRMATION_EMAIL_TO || null;
}

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<{ sent: boolean; error?: string }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) {
    console.log("[email not configured] would send to", msg.to, ":", msg.subject);
    return { sent: false, error: "email is not configured" };
  }
  try {
    const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await transport.sendMail({ from: `Hausmeister <${user}>`, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { sent: true };
  } catch (e) {
    console.error("email send failed", e);
    return { sent: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The tenant's booking confirmation: everything they need in one email. */
export function bookingEmail(d: {
  ticketId: number;
  tenantName: string;
  unit: string;
  building: string;
  address: string;
  issueSummary: string;
  urgency: string;
  contractorName: string;
  contractorCompany: string | null;
  trade: string;
  when: string;
  visitFirst: string | null;
  patternNote: string | null;
}): { subject: string; text: string; html: string } {
  const who = d.contractorCompany ? `${d.contractorName} (${d.contractorCompany})` : d.contractorName;
  const first = d.visitFirst && d.visitFirst !== d.unit ? `They'll check flat ${d.visitFirst} first, because the leak may be coming from there.` : null;
  const tip =
    d.urgency === "emergency"
      ? "If you smell gas or see smoke or sparks: leave the flat and call 112."
      : "Until they arrive: keep the area dry, put a bucket under any drip, and don't touch wet lights or sockets.";
  const rows: [string, string][] = [
    ["Ticket", `#${d.ticketId}`],
    ["Problem", d.issueSummary],
    ["Where", `Flat ${d.unit}, ${d.building}, ${d.address}`],
    ["Who's coming", `${who}, ${d.trade}`],
    ["When", d.when],
  ];
  const subject = `Booked: ${d.contractorName} the ${d.trade} is coming ${d.when} (ticket #${d.ticketId})`;
  const text = [
    `Hi ${d.tenantName},`,
    "",
    `Your repair is booked. Here are the details:`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(first ? ["", first] : []),
    ...(d.patternNote ? ["", `Why: ${d.patternNote}`] : []),
    "",
    tip,
    "",
    "Need to change something? Just call the caretaker line again.",
    "",
    "Hausmeister, your building's caretaker",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<p style="font-size:13px;color:#666;margin:0 0 8px">Hausmeister · ${esc(d.building)}</p>
<h1 style="font-size:20px;margin:0 0 16px">Your repair is booked</h1>
<p>Hi ${esc(d.tenantName)}, ${esc(d.contractorName)} the ${esc(d.trade)} is coming <b>${esc(d.when)}</b>.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;margin:16px 0">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`)
    .join("")}</table>
${first ? `<p>${esc(first)}</p>` : ""}${d.patternNote ? `<p style="color:#555">Why: ${esc(d.patternNote)}</p>` : ""}
<p style="background:#fff7e6;border:1px solid #ffe0a3;border-radius:6px;padding:10px 12px">${esc(tip)}</p>
<p style="font-size:13px;color:#666">Need to change something? Just call the caretaker line again.</p>
</body></html>`;
  return { subject, text, html };
}
