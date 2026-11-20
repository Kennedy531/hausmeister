"use client";
// The big-screen dashboard. Supabase realtime is only a "something changed" trigger;
// data always comes from /api/dashboard. Falls back to polling if realtime isn't set up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

interface Event { id: number; kind: string; message: string; created_at: string }
interface Ticket {
  id: number; unit: string; stack: string; visit_first: string | null; issue_type: string; urgency: string; status: string;
  summary: string; pattern_flag: boolean; pattern_note: string | null; photo_url: string | null; photo_assessment: string | null;
  photo_safety_advice: string | null; contractor_name: string | null; contractor_company: string | null; scheduled_label: string | null;
  call_started_at: string | null; booked_at: string | null; created_at: string; seed: boolean; tenant_call_id: string | null;
  dispatcher_call_id: string | null; dispatch_attempts: number; escalation_reason: string | null; events: Event[];
}
interface CallEvent { id: number; call_id: string; agent: "tenant" | "dispatcher"; role: string; text: string; ticket_id: number | null; created_at: string }
interface Unit { id: number; label: string; floor: number; stack: string }
interface State {
  now: string;
  building: { name: string; address: string; city: string; floors: number; build_year: number; boiler_type: string; last_boiler_service: string } | null;
  units: Unit[]; tickets: Ticket[]; calls: CallEvent[];
  lease_rules: { issue_type: string; responsible: string; note: string }[];
}

const STEPS = [
  { key: "call", label: "Caller known" },
  { key: "ticket", label: "Triaged" },
  { key: "photo", label: "Photo checked" },
  { key: "pattern", label: "History checked" },
  { key: "dispatch", label: "Contractor called" },
  { key: "booked", label: "Booked" },
  { key: "sms", label: "Tenant texted" },
] as const;

function fmtClock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Amsterdam" });
}

export default function DashboardView() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL
    setAdminKey(params.get("key") ?? (params.has("admin") ? "" : null));
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
    const clock = setInterval(() => setNow(Date.now()), 100);
    return () => {
      cleanup();
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load, refresh]);

  const view = useMemo(() => {
    if (!state) return null;
    const live = state.tickets.filter((t) => !t.seed);
    const ticket = live[0] ?? null;
    // A tenant call newer than the current ticket = a call in progress before its ticket exists.
    const tenantCalls = state.calls.filter((c) => c.agent === "tenant");
    const lastTenantCall = tenantCalls.at(-1)?.call_id ?? null;
    const activeTenantCall = ticket?.tenant_call_id ?? lastTenantCall;
    const callInProgressWithoutTicket = lastTenantCall && lastTenantCall !== ticket?.tenant_call_id ? lastTenantCall : null;
    const tenantCallId = callInProgressWithoutTicket ?? activeTenantCall;
    const current = callInProgressWithoutTicket ? null : ticket;
    const firstLine = state.calls.find((c) => c.call_id === tenantCallId);
    const startedAt = current?.call_started_at ?? firstLine?.created_at ?? null;
    const tenantLines = state.calls.filter((c) => c.call_id === tenantCallId);
    // Every dispatcher call for this ticket (a missed first contractor, then the next one).
    const dispatcherIds = new Set(
      state.calls.filter((c) => c.agent === "dispatcher" && current && c.ticket_id === current.id).map((c) => c.call_id),
    );
    if (current?.dispatcher_call_id) dispatcherIds.add(current.dispatcher_call_id);
    const dispatcherLines = state.calls.filter((c) => c.agent === "dispatcher" && dispatcherIds.has(c.call_id));
    return { current, startedAt, tenantLines, dispatcherLines };
  }, [state]);

  async function admin(path: string, body?: unknown) {
    setBusy(path);
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
      setBusy(null);
    }
  }

  if (!state || !view) {
    return (
      <div className="hm-shell hm-center">
        <Logo />
        <p className="hm-muted">{error ? `Can't reach the backend: ${error}` : "Connecting to the building…"}</p>
      </div>
    );
  }

  const { current, startedAt, tenantLines, dispatcherLines } = view;
  const stopAt = current?.booked_at ? Date.parse(current.booked_at) : null;
  const elapsed = startedAt ? (stopAt ?? now) - Date.parse(startedAt) : 0;
  const timerRunning = Boolean(startedAt && !stopAt && elapsed < 15 * 60e3);
  const done = stepState(current, tenantLines);
  const nextStep = STEPS.findIndex((s) => !done[s.key]);
  const rule = current ? state.lease_rules.find((r) => r.issue_type === current.issue_type) : null;
  const history = state.tickets.filter((t) => t.seed);
  const tenantLive = isLive(tenantLines, now);
  const dispatcherLive = isLive(dispatcherLines, now);
  const status = stopAt
    ? { cls: "hm-status-done", text: "Loop closed" }
    : tenantLive || dispatcherLive
      ? { cls: "hm-status-live", text: dispatcherLive ? "On the phone with the contractor" : "Live call" }
      : current?.status === "escalated"
        ? { cls: "hm-status-alert", text: "Escalated" }
        : { cls: "", text: "Waiting for a call" };

  return (
    <div className="hm-shell">
      <header className="hm-header">
        <div className="hm-brand">
          <Logo />
          <div>
            <h1 className="hm-title">Hausmeister</h1>
            <p className="hm-muted">The AI caretaker · {state.building?.name}, {state.building?.city}</p>
          </div>
        </div>
        <span className={`hm-status ${status.cls}`}>
          <span className="hm-status-dot" />
          {status.text}
        </span>
        <div className={`hm-timer-box ${stopAt ? "is-done" : timerRunning ? "is-live" : ""}`}>
          <span className="hm-timer-label">{stopAt ? "Call → plumber booked" : timerRunning ? "Since the tenant called" : "Call timer"}</span>
          <span className="hm-timer">{fmtClock(elapsed)}</span>
        </div>
      </header>

      <ol className="hm-rail">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`hm-rail-step ${done[s.key] ? "is-done" : i === nextStep && (timerRunning || current) ? "is-next" : ""}`}>
            <span className="hm-rail-dot">{done[s.key] ? "✓" : i + 1}</span>
            <span className="hm-rail-label">{s.label}</span>
          </li>
        ))}
      </ol>

      <main className="hm-grid">
        <section className="hm-panel hm-building-panel">
          <PanelHead title={state.building?.name ?? "Building"} tag="mock data" />
          <Building units={state.units} tickets={state.tickets} current={current} serverNow={state.now} />
          {state.building && (
            <div className="hm-facts">
              <Fact k="Built" v={String(state.building.build_year)} />
              <Fact k="Boiler" v={state.building.boiler_type} />
              <Fact k="Last service" v={state.building.last_boiler_service?.slice(0, 10)} />
            </div>
          )}
          {rule && (
            <p className="hm-rule">
              <span className="hm-tag">mock lease rule</span>
              <b>{rule.responsible === "landlord" ? "Landlord pays." : "Tenant pays."}</b> {rule.note}
            </p>
          )}
        </section>

        <section className="hm-panel hm-ticket-panel">
          {current ? (
            <>
              <div className="hm-ticket-head">
                <span className="hm-ticket-id">Ticket #{current.id}</span>
                <span className={`hm-pill hm-urg-${current.urgency}`}>{current.urgency}</span>
                <span className="hm-pill">{ISSUE_ICON[current.issue_type] ?? "🔧"} {current.issue_type}</span>
                <span className="hm-pill">Apt {current.unit}</span>
              </div>
              <h2 className="hm-summary">{current.summary}</h2>

              {current.pattern_flag && current.pattern_note && (
                <div className="hm-context">
                  <span className="hm-context-label">Building history · pattern found</span>
                  <p>{current.pattern_note}</p>
                </div>
              )}

              {(current.photo_url || current.photo_assessment) && (
                <div className="hm-vision">
                  {current.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={current.photo_url} alt="Tenant's photo of the damage" />
                  ) : (
                    <div className="hm-vision-ph">📷</div>
                  )}
                  <div>
                    <span className="hm-context-label hm-vision-label">Vision model</span>
                    <p>{current.photo_assessment}</p>
                    {current.photo_safety_advice && <p className="hm-advice">⚡ {current.photo_safety_advice}</p>}
                  </div>
                </div>
              )}

              {current.contractor_name && (
                <div className={`hm-contractor ${current.booked_at ? "is-booked" : "is-calling"}`}>
                  <span className="hm-avatar">{current.contractor_name.slice(0, 1)}</span>
                  <div className="hm-contractor-body">
                    <span className="hm-contractor-name">{current.contractor_name}</span>
                    <span className="hm-muted">{current.contractor_company}</span>
                  </div>
                  <div className="hm-contractor-state">
                    {current.booked_at ? (
                      <>
                        <span className="hm-booked-time">{current.scheduled_label}</span>
                        <span>{current.visit_first && current.visit_first !== current.unit ? `Booked · starts in ${current.visit_first}` : "Booked"}</span>
                      </>
                    ) : (
                      <span className="hm-ringing">☎ Calling…</span>
                    )}
                  </div>
                </div>
              )}

              {current.status === "escalated" && (
                <div className="hm-escalated">🚨 Escalated to the on-call manager. {current.escalation_reason}</div>
              )}

              <ul className="hm-timeline">
                {current.events.map((e) => (
                  <li key={e.id} className={`k-${e.kind}`}>
                    <time>{hhmm(e.created_at)}</time>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
              {adminKey !== null && current.status === "open" && (
                <button className="hm-btn" disabled={!!busy} onClick={() => admin("/api/demo/dispatch", { ticket_id: current.id })}>
                  Backup: dispatch now
                </button>
              )}
            </>
          ) : (
            <div className="hm-empty">
              <span className="hm-empty-icon">☎</span>
              <h2 className="hm-summary">{tenantLive ? "Listening…" : "Ready for a call"}</h2>
              <p className="hm-muted">
                {tenantLive
                  ? "The agent is triaging. The ticket appears the moment it's created."
                  : "A tenant calls the Hausmeister number. Everything that happens next shows up here, live."}
              </p>
            </div>
          )}
        </section>

        <section className="hm-panel hm-transcript">
          <Lane title="Tenant call" live={tenantLive} lines={tenantLines} who={{ user: "Tenant", assistant: "Hausmeister" }} />
          <Lane title="Contractor call" live={dispatcherLive} lines={dispatcherLines} who={{ user: current?.contractor_name ?? "Contractor", assistant: "Dispatcher" }} />
        </section>
      </main>

      <footer className="hm-footer">
        <div className="hm-history">
          <span className="hm-tag">mock data</span>
          <span className="hm-muted">Building history</span>
          {history.map((t) => (
            <span key={t.id} className={`hm-chip ${t.status === "resolved" ? "" : "is-open"}`}>
              {ISSUE_ICON[t.issue_type] ?? "🔧"} {t.unit} · {t.issue_type}
            </span>
          ))}
        </div>
        {adminKey !== null && (
          <button
            className="hm-btn hm-btn-quiet"
            disabled={!!busy}
            onClick={() => confirm("Reset the demo? Deletes all call tickets and transcripts.") && admin("/api/demo/reset")}
          >
            Reset demo
          </button>
        )}
      </footer>
    </div>
  );
}

const ISSUE_ICON: Record<string, string> = {
  leak: "💧", heating: "🔥", electrical: "⚡", lock: "🔑", appliance: "🧺", pest: "🐜", other: "🔧",
};

const TOOL_LABEL: Record<string, string> = {
  lookup_tenant: "Caller ID checked",
  get_building_context: "Building history checked",
  create_ticket: "Ticket created",
  send_photo_link: "Photo link texted",
  check_photo: "Photo checked",
  dispatch_contractor: "Contractor dispatched",
  confirm_slot: "Slot booked",
};

/** New rows are already plain language; older rows were "name → {json}". */
function toolText(text: string) {
  const m = text.match(/^(\w+) (→|✗) ([\s\S]*)$/);
  if (!m) return text;
  const [, name, arrow, rest] = m;
  if (!rest.trim().startsWith("{")) return rest;
  return `${TOOL_LABEL[name] ?? name}${arrow === "✗" ? " failed" : ""}`;
}

function isLive(lines: CallEvent[], now: number) {
  const last = lines.at(-1);
  if (!last) return false;
  if (last.role === "system" && last.text === "Call ended") return false;
  return now - Date.parse(last.created_at) < 5 * 60e3;
}

function Logo() {
  return (
    <svg className="hm-logo" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M6 19 20 7l14 12v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M20 17c3 4 4.6 6.4 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-2 1.6-4.4 4.6-8.4Z" fill="var(--water)" />
    </svg>
  );
}

function PanelHead({ title, tag }: { title: string; tag?: string }) {
  return (
    <div className="hm-panel-head">
      <h2>{title}</h2>
      {tag && <span className="hm-tag">{tag}</span>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v?: string }) {
  return (
    <div className="hm-fact">
      <span>{k}</span>
      <b>{v ?? "—"}</b>
    </div>
  );
}

function stepState(t: Ticket | null, tenantLines: CallEvent[]): Record<string, boolean> {
  const kinds = new Set(t?.events.map((e) => e.kind));
  return {
    call: tenantLines.length > 0 || Boolean(t),
    ticket: Boolean(t),
    photo: kinds.has("photo"),
    pattern: kinds.has("pattern") || tenantLines.some((l) => l.text.startsWith("get_building_context")),
    dispatch: kinds.has("dispatch"),
    booked: kinds.has("booked"),
    sms: [...(t?.events ?? [])].some((e) => e.kind === "sms" && e.message.startsWith("Tenant texted")),
  };
}

function Building({ units, tickets, current, serverNow }: { units: Unit[]; tickets: Ticket[]; current: Ticket | null; serverNow: string }) {
  const stacks = [...new Set(units.map((u) => u.stack))].sort();
  const floors = [...new Set(units.map((u) => u.floor))].sort((a, b) => b - a);
  const recent = Date.parse(serverNow) - 30 * 86400e3;
  const patternStack = current?.pattern_flag ? current.stack : null;
  return (
    <div className="hm-house">
      <div className="hm-roof" />
      <div className="hm-facade" style={{ gridTemplateColumns: `2.6rem repeat(${stacks.length}, 1fr)` }}>
        <span />
        {stacks.map((s) => (
          <span key={s} className={`hm-stack-label ${s === patternStack ? "is-pattern" : ""}`}>Stack {s}</span>
        ))}
        {floors.map((f) => (
          <FloorRow key={f} floor={f} stacks={stacks} units={units} tickets={tickets} current={current} recent={recent} patternStack={patternStack} />
        ))}
      </div>
      <div className="hm-ground" />
    </div>
  );
}

function FloorRow({ floor, stacks, units, tickets, current, recent, patternStack }: { floor: number; stacks: string[]; units: Unit[]; tickets: Ticket[]; current: Ticket | null; recent: number; patternStack: string | null }) {
  return (
    <>
      <span className="hm-floor">{floor}F</span>
      {stacks.map((s) => {
        const u = units.find((x) => x.floor === floor && x.stack === s);
        if (!u) return <span key={s} className="hm-unit is-void" />;
        const same = current
          ? tickets.filter((t) => t.unit === u.label && t.issue_type === current.issue_type && t.status !== "resolved" && Date.parse(t.created_at) > recent)
          : [];
        const isCaller = current?.unit === u.label;
        const isFirst = Boolean(current?.pattern_flag && current.visit_first === u.label);
        const inPattern = Boolean(patternStack && patternStack === u.stack && same.length > 0);
        const cls = ["hm-unit", s === patternStack ? "in-riser" : "", inPattern ? "is-pattern" : "", isCaller ? "is-caller" : "", isFirst ? "is-first" : ""].join(" ");
        return (
          <div key={s} className={cls}>
            <div className="hm-unit-top">
              <b>{u.label}</b>
              {inPattern && <span className="hm-drop">💧</span>}
            </div>
            {isFirst && <span className="hm-badge">Visit first</span>}
            {isCaller && !isFirst && <span className="hm-badge hm-badge-caller">Calling now</span>}
            {inPattern && !isCaller && <span className="hm-unit-note">{same[0].summary.split(",")[0]}</span>}
          </div>
        );
      })}
    </>
  );
}

function Lane({ title, live, lines, who }: { title: string; live: boolean; lines: CallEvent[]; who: { user: string; assistant: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  return (
    <div className={`hm-lane ${live ? "is-live" : ""}`}>
      <div className="hm-lane-head">
        <h3>{title}</h3>
        {live && <span className="hm-live">● Live</span>}
      </div>
      <div ref={ref} className="hm-lines">
        {lines.length === 0 && <p className="hm-lane-empty">No call yet</p>}
        {lines.map((l) =>
          l.role === "tool" ? (
            <p key={l.id} className="hm-msg-tool">⚙ {toolText(l.text)}</p>
          ) : l.role === "system" ? (
            <p key={l.id} className="hm-msg-system">{l.text}</p>
          ) : (
            <div key={l.id} className={`hm-msg ${l.role === "user" ? "is-user" : "is-agent"}`}>
              <span className="hm-msg-who">{l.role === "user" ? who.user : who.assistant}</span>
              <p>{l.text}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
