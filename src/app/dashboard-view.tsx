"use client";
// The big-screen dashboard. Supabase realtime is only a "something changed" trigger;
// data always comes from /api/dashboard. Falls back to polling if realtime isn't set up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

interface Event { id: number; kind: string; message: string; created_at: string }
interface Ticket {
  id: number; unit: string; stack: string; visit_first: string | null; issue_type: string; urgency: string; status: string;
  summary: string; pattern_flag: boolean; pattern_note: string | null; photo_url: string | null; photo_assessment: string | null;
  photo_safety_advice: string | null; contractor_name: string | null; contractor_company: string | null; contractor_rating: number | null; contractor_language: string | null; tenant_window: string | null;
  tenant_name: string | null; scheduled_label: string | null; call_started_at: string | null; booked_at: string | null;
  created_at: string; seed: boolean; tenant_call_id: string | null; dispatcher_call_id: string | null; dispatch_attempts: number;
  escalation_reason: string | null; events: Event[];
}
interface CallEvent { id: number; call_id: string; agent: "tenant" | "dispatcher"; role: string; text: string; lang: string | null; translation: string | null; ticket_id: number | null; created_at: string }
interface Unit { id: number; label: string; floor: number; stack: string }
interface State {
  now: string;
  building: { name: string; address: string; city: string; floors: number; build_year: number; boiler_type: string; last_boiler_service: string } | null;
  units: Unit[]; tickets: Ticket[]; calls: CallEvent[];
  lease_rules: { issue_type: string; responsible: string; note: string }[];
}

/** The demo has to finish inside this many seconds (pitch plan). */
const TARGET_SECONDS = 80;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function useDashboard() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refresh = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      load();
    }, 150);
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    let live = false;
    let cleanup = () => {};
    if (url && key) {
      const sb = createClient(url, key);
      const ch = sb
        .channel("dashboard")
        .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "ticket_events" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "call_events" }, refresh)
        .subscribe((status) => {
          live = status === "SUBSCRIBED";
        });
      cleanup = () => {
        sb.removeChannel(ch);
      };
    }
    // Safety net: poll fast when realtime isn't connected, slowly when it is.
    let ticks = 0;
    const poll = setInterval(() => {
      ticks++;
      if (!live || ticks % 10 === 0) load();
    }, 1500);
    return () => {
      cleanup();
      clearInterval(poll);
    };
  }, [load, refresh]);

  return { state, error, load };
}

function useNow(intervalMs = 100) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Transcript lines that belong to one ticket: its tenant call and every dispatcher call for it. */
function linesFor(t: Ticket | null, calls: CallEvent[], tenantCallId: string | null) {
  const tenantId = t?.tenant_call_id ?? tenantCallId;
  const tenant = tenantId ? calls.filter((c) => c.call_id === tenantId) : [];
  const ids = new Set(calls.filter((c) => c.agent === "dispatcher" && t && c.ticket_id === t.id).map((c) => c.call_id));
  if (t?.dispatcher_call_id) ids.add(t.dispatcher_call_id);
  const dispatcher = calls.filter((c) => c.agent === "dispatcher" && ids.has(c.call_id));
  return { tenant, dispatcher };
}

function isLive(lines: CallEvent[], now: number) {
  const last = lines.at(-1);
  if (!last || !now) return false;
  if (last.role === "system" && last.text === "Call ended") return false;
  return now - Date.parse(last.created_at) < 5 * 60e3;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardView() {
  const { state, error, load } = useDashboard();
  const now = useNow();
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [stage, setStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL
    setAdminKey(params.get("key") ?? (params.has("admin") ? "" : null));
    // ?stage=1: projector / video mode. Bigger, no sidebar, no admin buttons. Press S to toggle.
    setStage(params.has("stage"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "s" && !(e.target instanceof HTMLInputElement)) setStage((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const view = useMemo(() => {
    if (!state) return null;
    const callTickets = state.tickets.filter((t) => !t.seed);
    const latest = callTickets[0] ?? null;
    // A tenant call newer than the latest ticket is a call in progress before its ticket exists.
    const lastTenantCall = state.calls.filter((c) => c.agent === "tenant").at(-1)?.call_id ?? null;
    const pendingCall = lastTenantCall && lastTenantCall !== latest?.tenant_call_id ? lastTenantCall : null;
    const liveTicket = pendingCall ? null : latest;
    const selected = selectedId ? state.tickets.find((t) => t.id === selectedId) ?? null : null;
    const ticket = selected ?? liveTicket;
    const lines = linesFor(ticket, state.calls, selected ? null : pendingCall ?? latest?.tenant_call_id ?? null);
    const startedAt = ticket?.call_started_at ?? lines.tenant[0]?.created_at ?? null;
    return { callTickets, ticket, lines, startedAt, viewingPast: Boolean(selected) };
  }, [state, selectedId]);

  async function admin(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path + (adminKey ? `?key=${encodeURIComponent(adminKey)}` : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.started === false) alert(json.reason ?? json.error ?? `Failed (${res.status})`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state || !view) {
    return (
      <div className="ui-loading">
        <Logo />
        <p>{error ? `Can't reach the backend: ${error}` : "Connecting…"}</p>
      </div>
    );
  }

  const { ticket, lines, startedAt, viewingPast, callTickets } = view;
  const tenantLive = !viewingPast && isLive(lines.tenant, now);
  const dispatcherLive = !viewingPast && isLive(lines.dispatcher, now);
  const anyLive = tenantLive || dispatcherLive;
  const stopAt = ticket?.booked_at ? Date.parse(ticket.booked_at) : null;
  const running = Boolean(startedAt && !stopAt && !viewingPast && now && now - Date.parse(startedAt!) < 15 * 60e3);
  const elapsed = startedAt ? (stopAt ?? (running ? now : Date.parse(startedAt))) - Date.parse(startedAt) : 0;
  const status = statusOf(ticket, anyLive, dispatcherLive);
  // Hold the pattern back until the agent has looked up the history, so the screen doesn't
  // give away the context moment before it's said on the call.
  const revealPattern = Boolean(
    ticket?.pattern_flag &&
      (viewingPast || ticket.events.some((e) => e.kind === "dispatch") || lines.tenant.some((l) => l.role === "tool" && l.text.startsWith("get_building_context"))),
  );

  return (
    <div className={`ui-app ${stage ? "is-stage" : ""}`}>
      <Sidebar
        state={state}
        callTickets={callTickets}
        selectedId={viewingPast ? ticket?.id ?? null : null}
        live={anyLive}
        onSelect={setSelectedId}
        admin={adminKey !== null}
        busy={busy}
        onReset={() => confirm("Reset the demo? Deletes all call tickets and transcripts.") && admin("/api/demo/reset").then(() => setSelectedId(null))}
      />

      <div className="ui-main">
        <header className="ui-topbar">
          <nav className="ui-crumbs">
            <span>Hausmeister</span>
            <Sep />
            <span>{state.building?.name}</span>
            <Sep />
            <b>{viewingPast && ticket ? `Ticket #${ticket.id}` : "Live"}</b>
          </nav>
          <div className="ui-topbar-right">
            {viewingPast && (
              <button className="ui-btn" onClick={() => setSelectedId(null)}>
                <Icon name="arrowLeft" size={14} /> Back to live
              </button>
            )}
            {adminKey !== null && !stage && ticket?.status === "open" && !viewingPast && (
              <button className="ui-btn" disabled={busy} onClick={() => admin("/api/demo/dispatch", { ticket_id: ticket.id })}>
                <Icon name="phone" size={14} /> Dispatch manually
              </button>
            )}
          </div>
        </header>

        <section className="ui-hero">
          <div className="ui-hero-main">
            <div className="ui-hero-meta">
              <Badge tone={status.tone} pulse={status.pulse}>{status.label}</Badge>
              {ticket && <span className="ui-mono ui-subtle">#{ticket.id}</span>}
              {ticket && <span className="ui-subtle">{hhmm(ticket.created_at)}</span>}
            </div>
            <h1 className="ui-hero-title">
              {ticket ? ticket.summary : anyLive ? "Call in progress…" : "Waiting for a call"}
            </h1>
            <div className="ui-hero-sub">
              {ticket ? (
                <>
                  <span><Icon name="user" size={14} /> {ticket.tenant_name ?? "Unknown caller"}</span>
                  <span><Icon name="building" size={14} /> Apartment {ticket.unit}</span>
                  <span><Icon name={ISSUE_ICON[ticket.issue_type] ?? "wrench"} size={14} /> {cap(ticket.issue_type)}</span>
                  <Urgency value={ticket.urgency} />
                </>
              ) : (
                <span className="ui-subtle">
                  {anyLive ? "The agent is triaging. The ticket appears as soon as it's created." : "When a tenant calls, the whole repair loop plays out here in real time."}
                </span>
              )}
            </div>
          </div>
          <Timer elapsed={elapsed} running={running} done={Boolean(stopAt)} />
        </section>

        <div className="ui-grid">
          <div className="ui-col">
            <Card title="Activity" icon="activity">
              <Activity ticket={ticket} tenantLines={lines.tenant} startedAt={startedAt} live={anyLive} />
            </Card>
            <Card title="Building" icon="building" aside={<span className="ui-chip">Mock data</span>}>
              <BuildingMap units={state.units} tickets={state.tickets} ticket={ticket} serverNow={state.now} reveal={revealPattern} />
              {state.building && (
                <dl className="ui-kv ui-kv-compact">
                  <dt>Address</dt><dd>{state.building.address}, {state.building.city}</dd>
                  <dt>Built</dt><dd>{state.building.build_year}</dd>
                  <dt>Boiler</dt><dd>{state.building.boiler_type}</dd>
                </dl>
              )}
            </Card>
          </div>

          <div className="ui-col">
            {ticket?.booked_at && <Impact ticket={ticket} tickets={state.tickets} serverNow={state.now} />}
            {revealPattern && ticket?.pattern_note && (
              <div className="ui-insight">
                <div className="ui-insight-icon"><Icon name="sparkles" size={16} /></div>
                <div>
                  <div className="ui-insight-title">Pattern detected in stack {ticket.stack}</div>
                  <p>{ticket.pattern_note}</p>
                </div>
              </div>
            )}
            {ticket?.status === "escalated" && (
              <div className="ui-insight is-danger">
                <div className="ui-insight-icon"><Icon name="alert" size={16} /></div>
                <div>
                  <div className="ui-insight-title">Escalated to the on-call manager</div>
                  <p>{ticket.escalation_reason}</p>
                </div>
              </div>
            )}
            <Card title="Dispatch" icon="wrench">
              {ticket?.contractor_name ? (
                <>
                  <ContractorRow ticket={ticket} />
                  <NeighbourRow ticket={ticket} />
                </>
              ) : (
                <Empty icon="wrench" text={ticket ? "No contractor called yet." : "Nothing to dispatch."} />
              )}
            </Card>
            <Card title="Details" icon="ticket">
              {ticket ? <Details ticket={ticket} rule={state.lease_rules.find((r) => r.issue_type === ticket.issue_type)} /> : <Empty icon="ticket" text="No ticket yet." />}
            </Card>
            {(ticket?.photo_url || ticket?.photo_assessment) && (
              <Card title="Photo assessment" icon="camera">
                <div className="ui-photo">
                  {ticket.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={ticket.photo_url} alt="Tenant's photo of the damage" />
                  ) : (
                    <div className="ui-photo-ph"><Icon name="camera" size={20} /></div>
                  )}
                  <div>
                    <p>{ticket.photo_assessment}</p>
                    {ticket.photo_safety_advice && (
                      <p className="ui-advice"><Icon name="zap" size={13} /> {ticket.photo_safety_advice}</p>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>

          <Conversation
            key={ticket?.id ?? "none"}
            tenant={lines.tenant}
            dispatcher={lines.dispatcher}
            tenantLive={tenantLive}
            dispatcherLive={dispatcherLive}
            contractor={ticket?.contractor_name ?? "Contractor"}
            tenantName={ticket?.tenant_name ?? "Tenant"}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function statusOf(t: Ticket | null, live: boolean, dispatcherLive: boolean): { label: string; tone: Tone; pulse?: boolean } {
  if (t?.status === "escalated") return { label: "Escalated", tone: "danger" };
  if (t?.booked_at) return { label: "Booked", tone: "success" };
  if (dispatcherLive) return { label: "Calling contractor", tone: "info", pulse: true };
  if (live) return { label: "Live call", tone: "live", pulse: true };
  if (t?.status === "dispatching") return { label: "Dispatching", tone: "info" };
  if (t) return { label: cap(t.status), tone: "neutral" };
  return { label: "Idle", tone: "neutral" };
}

function Sidebar({ state, callTickets, selectedId, live, onSelect, admin, busy, onReset }: {
  state: State; callTickets: Ticket[]; selectedId: number | null; live: boolean; onSelect: (id: number | null) => void;
  admin: boolean; busy: boolean; onReset: () => void;
}) {
  const history = state.tickets.filter((t) => t.seed);
  return (
    <aside className="ui-sidebar">
      <div className="ui-brand">
        <Logo />
        <div>
          <div className="ui-brand-name">Hausmeister</div>
          <div className="ui-subtle">{state.building?.name} · {state.building?.city}</div>
        </div>
      </div>

      <nav className="ui-nav">
        <button className={`ui-nav-item ${selectedId === null ? "is-active" : ""}`} onClick={() => onSelect(null)}>
          <Icon name="radio" size={16} />
          <span>Live</span>
          {live && <span className="ui-live-dot" />}
        </button>
      </nav>

      <div className="ui-nav-section">
        <div className="ui-nav-heading">Calls</div>
        {callTickets.length === 0 && <div className="ui-nav-empty">No calls yet</div>}
        {callTickets.slice(0, 8).map((t) => (
          <TicketLink key={t.id} t={t} active={selectedId === t.id} onClick={() => onSelect(t.id)} />
        ))}
      </div>

      <div className="ui-nav-section ui-nav-history">
        <div className="ui-nav-heading">Building history <span className="ui-chip">Mock</span></div>
        {history.map((t) => (
          <TicketLink key={t.id} t={t} active={selectedId === t.id} onClick={() => onSelect(t.id)} />
        ))}
      </div>

      {admin && (
        <div className="ui-sidebar-foot">
          <button className="ui-btn ui-btn-block" disabled={busy} onClick={onReset}>
            <Icon name="rotate" size={14} /> Reset demo
          </button>
        </div>
      )}
    </aside>
  );
}

function TicketLink({ t, active, onClick }: { t: Ticket; active: boolean; onClick: () => void }) {
  return (
    <button className={`ui-ticket-link ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className={`ui-dot tone-${statusTone(t.status)}`} />
      <span className="ui-ticket-link-body">
        <span className="ui-ticket-link-title">{t.summary}</span>
        <span className="ui-subtle">{t.unit} · {cap(t.issue_type)} · {cap(t.status)}</span>
      </span>
    </button>
  );
}

function statusTone(s: string): Tone {
  return s === "scheduled" || s === "resolved" ? (s === "resolved" ? "neutral" : "success") : s === "escalated" ? "danger" : s === "dispatching" ? "info" : "warning";
}

function Timer({ elapsed, running, done }: { elapsed: number; running: boolean; done: boolean }) {
  const pct = Math.min(100, (elapsed / 1000 / TARGET_SECONDS) * 100);
  const over = elapsed / 1000 > TARGET_SECONDS;
  return (
    <div className={`ui-timer ${done ? "is-done" : running ? "is-running" : ""}`}>
      <div className="ui-timer-label">{done ? "Call to contractor booked" : "Time since call started"}</div>
      <div className="ui-timer-value ui-mono">{fmtClock(elapsed)}</div>
      <div className="ui-timer-bar"><span style={{ width: `${pct}%` }} className={over ? "is-over" : ""} /></div>
      <div className="ui-timer-scale ui-subtle"><span>0:00</span><span>Target {TARGET_SECONDS}s</span></div>
    </div>
  );
}

const ACTIVITY = [
  { key: "call", label: "Caller identified", icon: "phone" },
  { key: "created", label: "Ticket created", icon: "ticket" },
  { key: "photo", label: "Photo assessed", icon: "camera" },
  { key: "pattern", label: "Building history checked", icon: "history" },
  { key: "dispatch", label: "Contractor called", icon: "phone" },
  { key: "booked", label: "Slot booked", icon: "calendar" },
  { key: "sms", label: "Tenant notified", icon: "send" },
  { key: "neighbour", label: "Neighbour asked for access", icon: "key" },
] as const;

function Activity({ ticket, tenantLines, startedAt, live }: { ticket: Ticket | null; tenantLines: CallEvent[]; startedAt: string | null; live: boolean }) {
  const ev = (k: string) => ticket?.events.find((e) => e.kind === k);
  const historyLine = tenantLines.find((l) => l.role === "tool" && l.text.startsWith("get_building_context"));
  const smsEvent = ticket?.events.find((e) => e.kind === "sms" && /tenant/i.test(e.message));
  const steps: Record<string, { at?: string; detail?: string; state?: "done" | "warn" | "skip" }> = {
    call: tenantLines[0] || ticket
      ? { at: tenantLines[0]?.created_at ?? ticket?.call_started_at ?? undefined, detail: ticket?.tenant_name ? `${ticket.tenant_name} · ${ticket.unit}` : undefined, state: "done" }
      : {},
    created: ev("created") ? { at: ev("created")!.created_at, detail: ticket ? `${cap(ticket.urgency)} ${ticket.issue_type}` : undefined, state: "done" } : {},
    photo: ev("photo")
      ? { at: ev("photo")!.created_at, detail: "Vision model", state: "done" }
      : ticket && (ev("dispatch") || ev("pattern")) ? { state: "skip", detail: "Not needed" } : {},
    // When the agent asked for the history (its tool call), not when the ticket stored the pattern.
    pattern: historyLine || ev("pattern")
      ? {
          at: historyLine?.created_at ?? ev("pattern")?.created_at,
          detail: ticket?.pattern_flag ? `Pattern found · visit ${ticket.visit_first} first` : "No pattern",
          state: "done",
        }
      : ev("dispatch") ? { state: "done", detail: "No pattern" } : {},
    dispatch: ev("dispatch") ? { at: ev("dispatch")!.created_at, detail: ticket?.contractor_name ?? undefined, state: "done" } : {},
    booked: ev("booked") ? { at: ev("booked")!.created_at, detail: ticket?.scheduled_label ?? undefined, state: "done" } : {},
    sms: smsEvent
      ? smsEvent.message.startsWith("Tenant texted")
        ? { at: smsEvent.created_at, detail: "SMS delivered", state: "done" }
        : { at: smsEvent.created_at, detail: "SMS not configured", state: "warn" }
      : {},
  };
  const accessEv = ev("access");
  const askedEv = ev("neighbour");
  const notSent = Boolean(askedEv?.message.includes("not texted"));
  steps.neighbour = accessEv
    ? { at: accessEv.created_at, detail: accessEv.message, state: "done" }
    : askedEv
      ? { at: askedEv.created_at, detail: notSent ? "SMS not configured" : "Waiting for reply", state: notSent ? "warn" : "done" }
      : ev("booked") && (!ticket?.visit_first || ticket.visit_first === ticket.unit)
        ? { state: "skip", detail: "Not needed" }
        : {};
  const firstOpen = ACTIVITY.findIndex((a) => !steps[a.key].state);
  const base = startedAt ? Date.parse(startedAt) : null;

  return (
    <ol className="ui-activity">
      {ACTIVITY.map((a, i) => {
        const s = steps[a.key];
        const state = s.state ?? (i === firstOpen && (live || ticket?.status === "dispatching") ? "active" : "pending");
        return (
          <li key={a.key} className={`ui-step is-${state}`}>
            <span className="ui-step-icon">
              {state === "done" ? <Icon name="check" size={12} /> : state === "warn" ? "!" : state === "active" ? <span className="ui-spinner" /> : null}
            </span>
            <span className="ui-step-body">
              <span className="ui-step-label">{a.label}</span>
              {s.detail && <span className="ui-subtle">{s.detail}</span>}
            </span>
            <span className="ui-step-time ui-mono">{s.at && base ? offset(Date.parse(s.at) - base) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ContractorRow({ ticket }: { ticket: Ticket }) {
  const booked = Boolean(ticket.booked_at);
  return (
    <div className={`ui-contractor ${booked ? "is-booked" : "is-calling"}`}>
      <span className="ui-avatar">{ticket.contractor_name!.slice(0, 1)}</span>
      <div className="ui-contractor-body">
        <div className="ui-contractor-name">
          {ticket.contractor_name}
          {ticket.contractor_rating && <span className="ui-subtle"> · ★ {ticket.contractor_rating}</span>}
        </div>
        <div className="ui-subtle">
          {ticket.contractor_company}
          {ticket.tenant_window && !booked && <> · tenant home {ticket.tenant_window}</>}
        </div>
      </div>
      <div className="ui-contractor-state">
        {booked ? (
          <>
            <div className="ui-contractor-time">{cap(ticket.scheduled_label ?? "")}</div>
            <Badge tone="success">Confirmed</Badge>
          </>
        ) : ticket.status === "dispatching" ? (
          <Badge tone="info" pulse>Ringing</Badge>
        ) : (
          <Badge tone="neutral">{cap(ticket.status)}</Badge>
        )}
      </div>
    </div>
  );
}

function NeighbourRow({ ticket }: { ticket: Ticket }) {
  const access = ticket.events.find((e) => e.kind === "access");
  const asked = ticket.events.find((e) => e.kind === "neighbour");
  const shown = access ?? asked;
  if (!shown) return null;
  const notSent = !access && shown.message.includes("not texted");
  return (
    <div className="ui-neighbour">
      <span className="ui-neighbour-icon"><Icon name="key" size={14} /></span>
      <div className="ui-contractor-body">
        <div>Access to {ticket.visit_first}</div>
        <div className="ui-subtle">{shown.message}</div>
      </div>
      {access ? <Badge tone="success">Confirmed</Badge> : notSent ? <Badge tone="warning">Not sent</Badge> : <Badge tone="info" pulse>Awaiting reply</Badge>}
    </div>
  );
}

/** Shown once the job is booked: the business case in four numbers. */
function Impact({ ticket, tickets, serverNow }: { ticket: Ticket; tickets: Ticket[]; serverNow: string }) {
  const start = ticket.call_started_at ? Date.parse(ticket.call_started_at) : null;
  const seconds = start && ticket.booked_at ? Math.round((Date.parse(ticket.booked_at) - start) / 1000) : null;
  const recent = Date.parse(serverNow) - 30 * 86400e3;
  // One visit covers every open report of the same issue in the stack.
  const covered = ticket.pattern_flag
    ? tickets.filter(
        (t) => t.id !== ticket.id && t.stack === ticket.stack && t.issue_type === ticket.issue_type && t.status !== "resolved" && Date.parse(t.created_at) > recent,
      ).length
    : 0;
  const cost = ticket.events.filter((e) => e.kind === "cost").reduce((sum, e) => sum + (Number(e.message.split(" ")[1]) || 0), 0);
  const notified = 1 + (ticket.events.some((e) => e.kind === "neighbour" || e.kind === "access") ? 1 : 0);
  const langs = [...new Set(["en", ticket.contractor_language ?? "en"])].map((l) => l.toUpperCase()).join(" → ");
  const typical = process.env.NEXT_PUBLIC_TYPICAL_RESPONSE;
  return (
    <section className="ui-impact">
      <div className="ui-impact-head"><Icon name="sparkles" size={14} /> What this call did</div>
      <div className="ui-impact-grid">
        <Stat value={seconds !== null ? fmtDuration(seconds) : "—"} label="Call to plumber booked" note={typical ? `Typical: ${typical}` : undefined} />
        <Stat value={String(covered)} label={covered === 1 ? "Extra visit saved" : "Extra visits saved"} note={covered > 0 ? `${covered + 1} reports, 1 visit` : undefined} />
        <Stat value={String(notified)} label="Residents notified" note={notified > 1 ? "Caller + neighbour" : "Caller"} />
        <Stat value={cost > 0 ? `$${cost.toFixed(2)}` : langs} label={cost > 0 ? "Cost of the calls" : "Languages"} note={cost > 0 ? langs : undefined} />
      </div>
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="ui-stat">
      <div className="ui-stat-value">{value}</div>
      <div className="ui-stat-label">{label}</div>
      {note && <div className="ui-stat-note">{note}</div>}
    </div>
  );
}

function Details({ ticket, rule }: { ticket: Ticket; rule?: { responsible: string; note: string } }) {
  return (
    <dl className="ui-kv">
      <dt>Status</dt><dd><Badge tone={statusTone(ticket.status)}>{cap(ticket.status)}</Badge></dd>
      <dt>Urgency</dt><dd><Urgency value={ticket.urgency} /></dd>
      <dt>Issue</dt><dd>{cap(ticket.issue_type)}</dd>
      <dt>Apartment</dt><dd>{ticket.unit} <span className="ui-subtle">· stack {ticket.stack}</span></dd>
      {ticket.tenant_window && (<><dt>Tenant home</dt><dd>{cap(ticket.tenant_window)}</dd></>)}
      {ticket.visit_first && ticket.visit_first !== ticket.unit && (<><dt>Visit first</dt><dd>{ticket.visit_first}</dd></>)}
      {ticket.dispatch_attempts > 1 && (<><dt>Contractors tried</dt><dd>{ticket.dispatch_attempts}</dd></>)}
      {rule && (
        <>
          <dt>Who pays</dt>
          <dd>{rule.responsible === "landlord" ? "Landlord" : "Tenant"} <span className="ui-chip">Mock rule</span></dd>
        </>
      )}
    </dl>
  );
}

function BuildingMap({ units, tickets, ticket, serverNow, reveal }: { units: Unit[]; tickets: Ticket[]; ticket: Ticket | null; serverNow: string; reveal: boolean }) {
  const stacks = [...new Set(units.map((u) => u.stack))].sort();
  const floors = [...new Set(units.map((u) => u.floor))].sort((a, b) => b - a);
  const recent = Date.parse(serverNow) - 30 * 86400e3;
  return (
    <div>
      <div className="ui-map" style={{ gridTemplateColumns: `28px repeat(${stacks.length}, 1fr)` }}>
        <span />
        {stacks.map((s) => (
          <span key={s} className={`ui-map-col ${reveal && ticket?.stack === s ? "is-hot" : ""}`}>Stack {s}</span>
        ))}
        {floors.map((f) => (
          <MapRow key={f} floor={f} stacks={stacks} units={units} tickets={tickets} ticket={ticket} recent={recent} reveal={reveal} />
        ))}
      </div>
      <div className="ui-legend">
        <span><i className="ui-legend-swatch is-report" /> Similar report</span>
        <span><i className="ui-legend-swatch is-caller" /> Caller</span>
        <span><i className="ui-legend-swatch is-first" /> Visit first</span>
      </div>
    </div>
  );
}

function MapRow({ floor, stacks, units, tickets, ticket, recent, reveal }: { floor: number; stacks: string[]; units: Unit[]; tickets: Ticket[]; ticket: Ticket | null; recent: number; reveal: boolean }) {
  return (
    <>
      <span className="ui-map-floor ui-mono">{floor}</span>
      {stacks.map((s) => {
        const u = units.find((x) => x.floor === floor && x.stack === s);
        if (!u) return <span key={s} className="ui-map-cell is-void" />;
        const reported = Boolean(
          reveal && ticket && tickets.some((t) => t.id !== ticket.id && t.unit === u.label && t.issue_type === ticket.issue_type && t.status !== "resolved" && Date.parse(t.created_at) > recent),
        );
        const caller = ticket?.unit === u.label;
        const first = Boolean(reveal && ticket?.visit_first === u.label);
        return (
          <div key={s} className={`ui-map-cell ${reported ? "is-report" : ""} ${caller ? "is-caller" : ""} ${first ? "is-first" : ""}`}>
            <span>{u.label}</span>
            {first && <span className="ui-map-tag">1st</span>}
          </div>
        );
      })}
    </>
  );
}

function Conversation({ tenant, dispatcher, tenantLive, dispatcherLive, contractor, tenantName }: {
  tenant: CallEvent[]; dispatcher: CallEvent[]; tenantLive: boolean; dispatcherLive: boolean; contractor: string; tenantName: string;
}) {
  const [picked, setPicked] = useState<"tenant" | "dispatcher" | null>(null);
  const [subtitles, setSubtitles] = useState(true);
  // Follow the live call unless the viewer picked a tab.
  const auto = dispatcherLive || (!tenantLive && dispatcher.length > 0) ? "dispatcher" : "tenant";
  const tab = picked ?? auto;
  const lines = tab === "tenant" ? tenant : dispatcher;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length, tab]);
  const who = tab === "tenant" ? { user: tenantName, agent: "Hausmeister" } : { user: contractor, agent: "Dispatcher" };

  return (
    <section className="ui-card ui-convo">
      <div className="ui-card-head">
        <div className="ui-card-title"><Icon name="message" size={15} /> Conversation</div>
        <div className="ui-convo-tools">
        {[...tenant, ...dispatcher].some((l) => l.translation) && (
          <button className={`ui-toggle ${subtitles ? "is-on" : ""}`} onClick={() => setSubtitles((v) => !v)} title="English subtitles">
            <Icon name="languages" size={13} /> EN
          </button>
        )}
        <div className="ui-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "tenant"} className={tab === "tenant" ? "is-active" : ""} onClick={() => setPicked("tenant")}>
            Tenant {tenantLive && <span className="ui-live-dot" />}
          </button>
          <button role="tab" aria-selected={tab === "dispatcher"} className={tab === "dispatcher" ? "is-active" : ""} onClick={() => setPicked("dispatcher")}>
            Contractor {dispatcherLive && <span className="ui-live-dot" />}
          </button>
        </div>
        </div>
      </div>
      <div ref={ref} className="ui-messages">
        {lines.length === 0 && <Empty icon="message" text={tab === "tenant" ? "The tenant's call will appear here." : "The call to the contractor will appear here."} />}
        {lines.map((l) =>
          l.role === "tool" ? (
            <div key={l.id} className="ui-msg-tool">
              <Icon name="terminal" size={12} />
              <span>{toolText(l.text)}</span>
              <span className="ui-mono ui-subtle">{hhmm(l.created_at)}</span>
            </div>
          ) : l.role === "system" ? (
            <div key={l.id} className="ui-msg-system">{l.text}</div>
          ) : (
            <div key={l.id} className={`ui-msg ${l.role === "user" ? "is-user" : "is-agent"}`}>
              <div className="ui-msg-who">{l.role === "user" ? who.user : who.agent}</div>
              <div className="ui-msg-text">
                {l.text}
                {subtitles && l.translation && (
                  <div className="ui-translation">
                    <span className="ui-translation-label"><Icon name="languages" size={12} /> {langName(l.lang)} → English</span>
                    {l.translation}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "live";

function Badge({ tone, pulse, children }: { tone: Tone; pulse?: boolean; children: React.ReactNode }) {
  return (
    <span className={`ui-badge tone-${tone}`}>
      <span className={`ui-dot tone-${tone} ${pulse ? "is-pulse" : ""}`} />
      {children}
    </span>
  );
}

function Urgency({ value }: { value: string }) {
  return <Badge tone={value === "emergency" ? "danger" : value === "urgent" ? "warning" : "neutral"}>{cap(value)}</Badge>;
}

function Card({ title, icon, aside, children }: { title: string; icon: IconName; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="ui-card">
      <div className="ui-card-head">
        <div className="ui-card-title"><Icon name={icon} size={15} /> {title}</div>
        {aside}
      </div>
      <div className="ui-card-body">{children}</div>
    </section>
  );
}

function Empty({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="ui-empty">
      <Icon name={icon} size={18} />
      <span>{text}</span>
    </div>
  );
}

function Sep() {
  return <span className="ui-sep">/</span>;
}

function Logo() {
  return (
    <span className="ui-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 21a6 6 0 0 0 6-6c0-1.7-.9-3.3-2.6-4.7S12.4 6.9 12 4.6c-.4 2.3-1.7 4.3-3.4 5.7S6 13.3 6 15a6 6 0 0 0 6 6Z" fill="currentColor" />
      </svg>
    </span>
  );
}

const ICONS = {
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  check: "M20 6 9 17l-5-5",
  droplet: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z",
  building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2 M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2 M10 6h4 M10 10h4 M10 14h4 M10 18h4",
  ticket: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z M13 5v2 M13 17v2 M13 11v2",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  alert: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  message: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  sparkles: "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z",
  rotate: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
  zap: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  send: "M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z M21.85 2.15 10.91 13.09",
  calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  arrowLeft: "m12 19-7-7 7-7 M19 12H5",
  radio: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9 M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5 M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5 M19.1 4.9C23 8.8 23 15.1 19.1 19 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  activity: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  terminal: "m4 17 6-6-6-6 M12 19h8",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  key: "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4 M21 2l-9.6 9.6 M15.5 12a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0",
  languages: "M5 8l6 6 M4 14l6-6 2-3 M2 5h12 M7 2h1 M22 22l-5-10-5 10 M14 18h6",
} as const;
type IconName = keyof typeof ICONS;

const ISSUE_ICON: Record<string, IconName> = {
  leak: "droplet", heating: "flame", electrical: "zap", lock: "key", appliance: "wrench", pest: "alert", other: "wrench",
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].split(/ (?=M|m)/).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const TOOL_LABEL: Record<string, string> = {
  lookup_tenant: "Caller ID checked",
  get_building_context: "Building history checked",
  create_ticket: "Ticket created",
  send_photo_link: "Photo link texted",
  check_photo: "Photo checked",
  dispatch_contractor: "Contractor dispatched",
  confirm_slot: "Slot booked",
};

/** New rows are already plain language ("name → text"); older rows were "name → {json}". */
function toolText(text: string) {
  const m = text.match(/^(\w+) (→|✗) ([\s\S]*)$/);
  if (!m) return text;
  const [, name, arrow, rest] = m;
  if (!rest.trim().startsWith("{")) return rest;
  return `${TOOL_LABEL[name] ?? name}${arrow === "✗" ? " failed" : ""}`;
}

function fmtClock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

function offset(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

const LANG_NAME: Record<string, string> = { nl: "Dutch", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", tr: "Turkish", ar: "Arabic", pl: "Polish" };

function langName(code: string | null) {
  return (code && LANG_NAME[code]) || (code ? code.toUpperCase() : "Translated");
}

function fmtDuration(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
