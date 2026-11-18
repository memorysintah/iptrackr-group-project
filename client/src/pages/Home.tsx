import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Crosshair,
  Globe2,
  History,
  Laptop,
  Loader2,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
} from "lucide-react";

type SignalSource = "manual" | "current" | "demo";

type Signal = {
  id?: string;
  ip: string;
  country: string;
  countryCode?: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  isp: string;
  asn?: string;
  accuracyRadius?: number;
  timestamp: string;
  timezone?: string;
  source?: SignalSource;
};

type LookupResponse = Omit<Signal, "id" | "source">;

const HISTORY_KEY = "iptrackr-history-v1";

const demoSignal: Signal = {
  id: "demo-signal",
  ip: "8.8.8.8",
  country: "United States",
  countryCode: "US",
  region: "California",
  city: "Mountain View",
  latitude: 37.4056,
  longitude: -122.0775,
  isp: "Google LLC",
  asn: "AS15169",
  accuracyRadius: 35,
  timestamp: new Date().toISOString(),
  timezone: "America/Los_Angeles",
  source: "demo",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

function MapField({ signal }: { signal: Signal | null }) {
  const mapUrl = signal
    ? `/api/static-map?lat=${encodeURIComponent(signal.latitude)}&lng=${encodeURIComponent(signal.longitude)}&radius=${encodeURIComponent(signal.accuracyRadius || 35)}`
    : "";

  return (
    <div className="map-card">
      <div className="map-card__topline">
        <div className="map-card__label">
          <MapPin size={14} /> REAL MAP · ESTIMATED NETWORK POSITION
        </div>
        <span className="map-card__scale">ROADMAP VIEW</span>
      </div>
      <div
        className="map-field"
        aria-label="Real map showing the approximate IP location"
      >
        {mapUrl ? (
          <img
            className="real-map"
            src={mapUrl}
            alt={
              signal
                ? `Roadmap showing the approximate network location near ${signal.city}, ${signal.country}`
                : "Real roadmap"
            }
          />
        ) : (
          <div className="real-map-message">
            <MapPin size={19} />
            <strong>Real map unavailable</strong>
            <span>The coordinates are shown in the evidence panel.</span>
          </div>
        )}
        <div className="map-field__caption">
          <span>
            <span className="map-dot" />{" "}
            {signal
              ? `${signal.city}, ${signal.country}`
              : "No lookup selected"}
          </span>
          <span>
            {signal?.accuracyRadius
              ? `±${signal.accuracyRadius} km radius`
              : "Awaiting estimate"}
          </span>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong className={mono ? "mono" : ""}>{value || "—"}</strong>
    </div>
  );
}

export default function Home() {
  const [ip, setIp] = useState("");
  const [result, setResult] = useState<Signal>(demoSignal);
  const [history, setHistory] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("Demo sample loaded");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch {
      // Local history is optional; the live lookup still works when storage is unavailable.
    }
  }, []);

  const persistHistory = (nextHistory: Signal[]) => {
    setHistory(nextHistory);
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      // Keep the current session usable if storage is blocked.
    }
  };

  const handleLookup = async (mode: "manual" | "current") => {
    let requestedIp = mode === "manual" ? ip.trim() : "";
    if (mode === "manual" && !requestedIp) {
      setError("Enter a public IP address first, or choose detect current IP.");
      setStatus("Input needed");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus(
      mode === "current"
        ? "Detecting the current public IP…"
        : "Resolving network signal…"
    );

    try {
      if (mode === "current") {
        setStatus("Reading the browser's public IP…");
        const detectedResponse = await fetch("https://api64.ipify.org?format=json", {
          cache: "no-store",
        });
        const detectedPayload = (await detectedResponse.json()) as { ip?: string };
        if (!detectedResponse.ok || !detectedPayload.ip) {
          throw new Error(
            "The browser's public IP could not be detected. Enter it manually instead."
          );
        }
        requestedIp = detectedPayload.ip;
      }

      const url = requestedIp
        ? `/api/ip-lookup?ip=${encodeURIComponent(requestedIp)}`
        : "/api/ip-lookup";
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "The lookup could not be completed.");

      const nextSignal: Signal = {
        ...(payload as LookupResponse),
        id: `${payload.ip}-${payload.timestamp}`,
        source: mode,
      };
      setResult(nextSignal);
      setIp(nextSignal.ip);
      const nextHistory = [
        nextSignal,
        ...history.filter(item => item.ip !== nextSignal.ip),
      ].slice(0, 12);
      persistHistory(nextHistory);
      setStatus(
        mode === "current" ? "Current public IP resolved" : "Lookup complete"
      );
    } catch (lookupError) {
      setError(
        lookupError instanceof Error
          ? lookupError.message
          : "The lookup failed. Try another public IP."
      );
      setStatus("Lookup needs attention");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectHistory = (signal: Signal) => {
    setResult(signal);
    setIp(signal.ip);
    setError("");
    setStatus("History entry selected");
  };

  const resetDemo = () => {
    setResult(demoSignal);
    setIp("");
    setError("");
    setStatus("Demo sample loaded");
  };

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radar size={20} strokeWidth={2.5} />
          </div>
          <div>
            <span className="brand-name">IPTrackr</span>
            <span className="brand-subtitle">FIELD STUDY / 01</span>
          </div>
        </div>

        <div className="rail-rule" />
        <nav className="rail-nav" aria-label="Application sections">
          <a className="rail-nav__item rail-nav__item--active" href="#latest">
            <Activity size={15} /> Latest signal <span>01</span>
          </a>
          <a className="rail-nav__item" href="#history">
            <History size={15} /> Lookup history{" "}
            <span>{history.length.toString().padStart(2, "0")}</span>
          </a>
          <a className="rail-nav__item" href="#method">
            <CircleHelp size={15} /> How it works <ChevronRight size={14} />
          </a>
        </nav>

        <div className="rail-note">
          <div className="rail-note__icon">
            <ShieldCheck size={16} />
          </div>
          <p>
            <strong>Privacy note</strong> This demonstration keeps history in
            this browser only. An IP estimate is not a precise device fix.
          </p>
        </div>

        <div className="rail-footer">
          <span className="status-led">
            <span /> DEMO ENVIRONMENT
          </span>
          <span className="mono">v1.0.0</span>
        </div>
      </aside>

      <main className="app-main">
        <header className="topbar">
          <span className="eyebrow">
            GIS GROUP PROJECT <span>/</span> IP GEOLOCATION
          </span>
          <div className="topbar-meta">
            <span className="topbar-meta__led" /> LIVE LOOKUP READY{" "}
            <span className="topbar-divider" /> LOCAL HISTORY
          </div>
        </header>

        <section className="intro-block">
          <div className="intro-copy">
            <p className="section-kicker">
              <span className="kicker-line" /> NETWORK LOCATION STUDY
            </p>
            <h1>
              Know what the signal can
              <br />
              and cannot tell you.
            </h1>
            <p className="intro-description">
              IPTrackr turns a public IP address into an approximate network
              location. Use it to demonstrate the method, then read the evidence
              with the right amount of doubt.
            </p>
          </div>
          <div className="intro-callout">
            <span className="callout-index">01</span>
            <div>
              <strong>Approximate, not GPS</strong>
              <p>
                The plotted point may describe an ISP gateway, VPN exit node, or
                shared network—not the laptop itself.
              </p>
            </div>
          </div>
        </section>

        <section className="lookup-panel" aria-label="IP lookup controls">
          <div className="lookup-panel__heading">
            <span className="panel-index">A</span>
            <div>
              <span className="panel-label">START A LOOKUP</span>
              <span className="panel-helper">
                Use a public IPv4 or IPv6 address.
              </span>
            </div>
          </div>
          <div className="lookup-controls">
            <div className="ip-input-wrap">
              <Search size={17} />
              <input
                value={ip}
                onChange={event => setIp(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") void handleLookup("manual");
                }}
                placeholder="Enter public IP address"
                aria-label="Public IP address"
                spellCheck={false}
              />
              {ip && (
                <button
                  className="clear-input"
                  onClick={() => setIp("")}
                  aria-label="Clear IP address"
                >
                  ×
                </button>
              )}
            </div>
            <button
              className="primary-action"
              onClick={() => void handleLookup("manual")}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Crosshair size={16} />
              )}
              {isLoading ? "Resolving" : "Locate IP"}
              <ArrowUpRight size={15} />
            </button>
            <button
              className="secondary-action"
              onClick={() => void handleLookup("current")}
              disabled={isLoading}
            >
              <Wifi size={16} /> Detect current IP
            </button>
          </div>
          <div
            className={`lookup-status ${error ? "lookup-status--error" : ""}`}
          >
            {error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{error || status}</span>
            {error && <button onClick={() => setError("")}>Dismiss</button>}
          </div>
        </section>

        <section className="section-heading" id="latest">
          <div>
            <span className="section-kicker">
              <span className="kicker-line" /> LATEST SIGNAL
            </span>
            <h2>One address. One estimate.</h2>
          </div>
          <button className="text-action" onClick={resetDemo}>
            <RefreshCw size={14} /> Reset demo view
          </button>
        </section>

        <section className="signal-layout">
          <MapField signal={result} />
          <aside className="evidence-card">
            <div className="evidence-card__header">
              <div>
                <span className="panel-label">SIGNAL EVIDENCE</span>
                <h3>
                  {result.city || "Unknown city"}
                  <span>, {result.country || "Unknown country"}</span>
                </h3>
              </div>
              <span
                className={`confidence-pill ${result.source === "demo" ? "confidence-pill--demo" : ""}`}
              >
                <span /> {result.source === "demo" ? "SAMPLE" : "ESTIMATE"}
              </span>
            </div>
            <p className="evidence-summary">
              This is the location associated with the network address at lookup
              time. It is a useful regional clue, not proof of where the laptop
              is.
            </p>
            <div className="detail-list">
              <DetailRow label="Public IP" value={result.ip} mono />
              <DetailRow label="Network / ISP" value={result.isp} />
              <DetailRow label="Region" value={result.region} />
              <DetailRow
                label="Coordinates"
                value={`${formatCoordinate(result.latitude, "N", "S")} · ${formatCoordinate(result.longitude, "E", "W")}`}
                mono
              />
              <DetailRow
                label="Lookup time"
                value={formatDate(result.timestamp)}
                mono
              />
            </div>
            <div className="radius-card">
              <div className="radius-card__icon">
                <Globe2 size={17} />
              </div>
              <div>
                <span className="panel-label">ESTIMATED RADIUS</span>
                <strong>
                  {result.accuracyRadius
                    ? `±${result.accuracyRadius} km`
                    : "Not supplied"}
                </strong>
              </div>
              <span className="radius-card__hint">
                Typical IP-level uncertainty
              </span>
            </div>
          </aside>
        </section>

        <section className="history-section" id="history">
          <div className="section-heading section-heading--tight">
            <div>
              <span className="section-kicker">
                <span className="kicker-line" /> RECENT LOOKUPS
              </span>
              <h2>Your local evidence trail.</h2>
            </div>
            <span className="history-count">
              {history.length.toString().padStart(2, "0")} / 12 saved
            </span>
          </div>
          {history.length === 0 ? (
            <div className="empty-history">
              <History size={18} />
              <span>
                Your completed lookups will appear here. They stay in this
                browser for the demonstration.
              </span>
            </div>
          ) : (
            <div className="history-list">
              {history.map(item => (
                <button
                  key={item.id || item.ip}
                  className={`history-row ${result.ip === item.ip ? "history-row--selected" : ""}`}
                  onClick={() => handleSelectHistory(item)}
                >
                  <span className="history-row__marker">
                    <MapPin size={14} />
                  </span>
                  <span className="history-row__location">
                    <strong>{item.city || "Unknown city"}</strong>
                    <small>{item.region || item.country}</small>
                  </span>
                  <span className="history-row__ip mono">{item.ip}</span>
                  <span className="history-row__time">
                    {formatDate(item.timestamp)}
                  </span>
                  <ChevronRight size={15} className="history-row__arrow" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="method-section" id="method">
          <div className="method-intro">
            <span className="section-kicker">
              <span className="kicker-line" /> THE METHOD, WITHOUT THE MYSTIQUE
            </span>
            <h2>How does IP geolocation work?</h2>
            <p>
              A provider compares the public address with network registration,
              routing, ISP, and observed location data. The result is an
              informed estimate—not a coordinate emitted by the laptop.
            </p>
          </div>
          <div className="method-steps">
            <div className="method-step">
              <span>01</span>
              <div>
                <Laptop size={17} />
                <strong>Request</strong>
                <p>The web server sees the public IP used to reach it.</p>
              </div>
            </div>
            <div className="method-step">
              <span>02</span>
              <div>
                <Globe2 size={17} />
                <strong>Compare</strong>
                <p>
                  A geolocation database maps the address range to a likely
                  region.
                </p>
              </div>
            </div>
            <div className="method-step">
              <span>03</span>
              <div>
                <MapPin size={17} />
                <strong>Estimate</strong>
                <p>
                  The dashboard plots a city-level clue with an uncertainty
                  radius.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="limitations-strip">
          <div className="limitations-strip__title">
            <AlertTriangle size={17} />
            <strong>Read the caveat</strong>
          </div>
          <p>
            VPNs, proxies, NAT, mobile networks, dynamic addresses, and shared
            Wi-Fi can all move the estimate away from the laptop. Never use IP
            geolocation alone for precise tracking or sensitive decisions.
          </p>
          <a
            href="https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For"
            target="_blank"
            rel="noreferrer"
          >
            Technical note <ArrowUpRight size={14} />
          </a>
        </section>

        <footer className="app-footer">
          <span>IPTRACKR / GIS FIELD STUDY</span>
          <span className="mono">PUBLIC IP ≠ GPS</span>
          <span>BUILT FOR LEARNING</span>
        </footer>
      </main>
    </div>
  );
}
