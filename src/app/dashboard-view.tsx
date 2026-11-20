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
      <div className="hm-shell grid place-items-center">
        <p className="text-xl opacity-70">{error ? `Can't reach the backend: ${error}` : "Loading…"}</p>
      </div>
    );
  }

  const { current, startedAt, tenantLines, dispatcherLines } = view;
  const stopAt = current?.booked_at ? Date.parse(current.booked_at) : null;
  const elapsed = startedAt ? (stopAt ?? now) - Date.parse(startedAt) : 0;
  const timerRunning = Boolean(startedAt && !stopAt && elapsed < 15 * 60e3);
  const done = stepState(current, tenantLines);
  const rule = current ? state.lease_rules.find((r) => r.issue_type === current.issue_type) : null;
  const history = state.tickets.filter((t) => t.seed);

  return (
    <div className="hm-shell">
      <header className="hm-header">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hausmeister</h1>
          <p className="hm-muted">AI caretaker · {state.building?.name} · {state.building?.city}</p>
        </div>
        <div className="text-right">
          <div className={`hm-timer ${stopAt ? "hm-timer-done" : timerRunning ? "hm-timer-live" : ""}`}>{fmtClock(elapsed)}</div>
          <p className="hm-muted text-sm">{stopAt ? "call → contractor booked" : timerRunning ? "since the tenant called" : "waiting for a call"}</p>
        </div>
      </header>

      <ol className="hm-steps">
        {STEPS.map((s) => (
          <li key={s.key} className={done[s.key] ? "hm-step hm-step-done" : "hm-step"}>
            <span className="hm-dot" />
            {s.label}
          </li>
        ))}
      </ol>

      <main className="hm-grid">
        <section className="hm-card">
          <h2 className="hm-h2">Building B <span className="hm-tag">mock data</span></h2>
          <Stack units={state.units} tickets={state.tickets} current={current} serverNow={state.now} />
          {state.building && (
            <dl className="hm-facts">
              <dt>Built</dt><dd>{state.building.build_year}</dd>
              <dt>Boiler</dt><dd>{state.building.boiler_type}</dd>
              <dt>Last service</dt><dd>{state.building.last_boiler_service?.slice(0, 10)}</dd>
            </dl>
          )}
          {rule && (
            <p className="hm-rule">
              <span className="hm-tag">mock lease rule</span> {rule.responsible === "landlord" ? "Landlord pays" : "Tenant pays"}: {rule.note}
            </p>
          )}
        </section>

        <section className="hm-card">
          <h2 className="hm-h2">
            {current ? <>Ticket #{current.id} <span className={`hm-urg hm-urg-${current.urgency}`}>{current.urgency}</span></> : "No live ticket yet"}
          </h2>
          {current ? (
            <>
              <p className="text-lg">{current.summary}</p>
              <p className="hm-muted">{current.issue_type} · apartment {current.unit} · status <b>{current.status}</b></p>
              {current.pattern_flag && current.pattern_note && <div className="hm-pattern">⚠ {current.pattern_note}</div>}
              {(current.photo_url || current.photo_assessment) && (
                <div className="hm-photo">
                  {current.photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={current.photo_url} alt="Tenant's photo of the damage" />
                  )}
                  <div>
                    <p><b>Vision:</b> {current.photo_assessment}</p>
                    {current.photo_safety_advice && <p className="hm-muted">Advice: {current.photo_safety_advice}</p>}
                  </div>
                </div>
              )}
              {current.contractor_name && (
                <div className={current.booked_at ? "hm-booked" : "hm-dispatching"}>
                  {current.booked_at
                    ? `✓ ${current.contractor_name} (${current.contractor_company}) booked for ${current.scheduled_label}${current.visit_first && current.visit_first !== current.unit ? ` · visiting ${current.visit_first} first` : ""}`
                    : `☎ Calling ${current.contractor_name} (${current.contractor_company})…`}
                </div>
              )}
              {current.status === "escalated" && <div className="hm-escalated">Escalated to the on-call manager: {current.escalation_reason}</div>}
              <ul className="hm-timeline">
                {current.events.map((e) => (
                  <li key={e.id}><time>{hhmm(e.created_at)}</time> {e.message}</li>
                ))}
              </ul>
              {adminKey !== null && current.status === "open" && (
                <button className="hm-btn" disabled={!!busy} onClick={() => admin("/api/demo/dispatch", { ticket_id: current.id })}>
                  Backup: dispatch now
                </button>
              )}
            </>
          ) : (
            <p className="hm-muted">Call the Hausmeister number. The ticket appears here the moment the agent creates it.</p>
          )}
        </section>

        <section className="hm-card hm-transcript">
          <h2 className="hm-h2">Live transcript</h2>
          <Lane title="Tenant call" lines={tenantLines} who={{ user: "Tenant", assistant: "Hausmeister" }} />
          <Lane title="Contractor call" lines={dispatcherLines} who={{ user: current?.contractor_name ?? "Contractor", assistant: "Dispatcher" }} />
        </section>
      </main>

      <footer className="hm-footer">
        <div className="hm-history">
          <span className="hm-tag">mock data</span> Building history:{" "}
          {history.map((t) => (
            <span key={t.id} className="hm-chip">{t.unit} · {t.issue_type} · {t.status}</span>
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

function Stack({ units, tickets, current, serverNow }: { units: Unit[]; tickets: Ticket[]; current: Ticket | null; serverNow: string }) {
  const stacks = [...new Set(units.map((u) => u.stack))].sort();
  const floors = [...new Set(units.map((u) => u.floor))].sort((a, b) => b - a);
  const recent = Date.parse(serverNow) - 30 * 86400e3;
  return (
    <div className="hm-stack" style={{ gridTemplateColumns: `auto repeat(${stacks.length}, 1fr)` }}>
      <span />
      {stacks.map((s) => <span key={s} className="hm-muted text-center text-sm">Stack {s}</span>)}
      {floors.map((f) => (
        <FloorRow key={f} floor={f} stacks={stacks} units={units} tickets={tickets} current={current} recent={recent} />
      ))}
    </div>
  );
}

function FloorRow({ floor, stacks, units, tickets, current, recent }: { floor: number; stacks: string[]; units: Unit[]; tickets: Ticket[]; current: Ticket | null; recent: number }) {
  return (
    <>
      <span className="hm-muted text-sm self-center">Floor {floor}</span>
      {stacks.map((s) => {
        const u = units.find((x) => x.floor === floor && x.stack === s);
        if (!u) return <span key={s} />;
        const same = current
          ? tickets.filter((t) => t.unit === u.label && t.issue_type === current.issue_type && t.status !== "resolved" && Date.parse(t.created_at) > recent)
          : [];
        const isCaller = current?.unit === u.label;
        const isFirst = current?.pattern_flag && current.visit_first === u.label;
        const inPattern = current?.pattern_flag && current.stack === u.stack && same.length > 0;
        return (
          <div key={s} className={`hm-unit ${inPattern ? "hm-unit-pattern" : ""} ${isCaller ? "hm-unit-caller" : ""}`}>
            <b>{u.label}</b>
            {isFirst && <span className="hm-badge">visit first</span>}
            {isCaller && !isFirst && <span className="hm-badge hm-badge-caller">caller</span>}
            {inPattern && !isCaller && <span className="hm-muted text-xs">{same[0].summary}</span>}
          </div>
        );
      })}
    </>
  );
}

function Lane({ title, lines, who }: { title: string; lines: CallEvent[]; who: { user: string; assistant: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  return (
    <div className="hm-lane">
      <h3 className="hm-muted text-sm uppercase tracking-wide">{title}</h3>
      <div ref={ref} className="hm-lines">
        {lines.length === 0 && <p className="hm-muted">—</p>}
        {lines.map((l) =>
          l.role === "tool" ? (
            <p key={l.id} className="hm-line-tool">⚙ {l.text}</p>
          ) : l.role === "system" ? (
            <p key={l.id} className="hm-line-system">{l.text}</p>
          ) : (
            <p key={l.id} className={l.role === "user" ? "hm-line-user" : "hm-line-agent"}>
              <b>{l.role === "user" ? who.user : who.assistant}:</b> {l.text}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
