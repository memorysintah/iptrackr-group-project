import "dotenv/config";
import express from "express";
import { isIP } from "node:net";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function normalizeIp(value: string) {
  return value
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/i, "");
}

function isPrivateOrReserved(ip: string) {
  const normalized = normalizeIp(ip);
  const version = isIP(normalized);
  if (version === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && b >= 18 && b <= 19) ||
      a >= 224
    );
  }

  if (version === 6) {
    const lower = normalized.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    );
  }

  return true;
}

function getForwardedClientIp(req: express.Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0)
    return normalizeIp(forwarded.split(",")[0]);
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0)
    return normalizeIp(realIp);
  return normalizeIp(req.socket.remoteAddress || "");
}

async function getCurrentPublicIp(req: express.Request) {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    if (response.ok) {
      const payload = (await response.json()) as { ip?: string };
      if (payload.ip) return normalizeIp(payload.ip);
    }
  } catch {
    // Fall back to the server-observed address below.
  }
  return getForwardedClientIp(req);
}

async function lookupIp(ip: string) {
  const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as {
    success?: boolean;
    message?: string;
    ip?: string;
    country?: string;
    country_code?: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: { id?: string };
    connection?: { isp?: string; org?: string; asn?: number | string };
  };

  if (
    !response.ok ||
    payload.success === false ||
    typeof payload.latitude !== "number" ||
    typeof payload.longitude !== "number"
  ) {
    throw new Error(
      payload.message ||
        "The geolocation provider could not resolve this address."
    );
  }

  return {
    ip: payload.ip || ip,
    country: payload.country || "Unknown country",
    countryCode: payload.country_code || "",
    region: payload.region || "Unknown region",
    city: payload.city || "Unknown city",
    latitude: payload.latitude,
    longitude: payload.longitude,
    isp:
      payload.connection?.isp || payload.connection?.org || "Unknown network",
    asn: payload.connection?.asn ? `AS${payload.connection.asn}` : "",
    accuracyRadius: 35,
    timezone: payload.timezone?.id || "",
    timestamp: new Date().toISOString(),
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .type("application/javascript")
      .send(publicPlatformScript());
  });
  app.get("/api/static-map", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    const radius = Number(req.query.radius) || 35;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).send("Invalid map coordinates.");
    }

    const apiUrl = process.env.MANUS_API_URL;
    const apiKey = process.env.MANUS_API_KEY;
    if (!apiUrl || !apiKey) return res.status(503).send("Map service is not configured.");

    const zoom = radius > 100 ? 5 : radius > 50 ? 6 : 8;
    const params = new URLSearchParams({
      center: `${latitude},${longitude}`,
      zoom: String(zoom),
      size: "760x320",
      scale: "2",
      maptype: "roadmap",
      markers: `color:green|label:I|${latitude},${longitude}`,
      key: apiKey,
    });

    try {
      const response = await fetch(
        `${apiUrl.replace(/\/$/, "")}/v1/maps/proxy/maps/api/staticmap?${params.toString()}`
      );
      if (!response.ok) return res.status(502).send("The map service could not render this location.");
      const contentType = response.headers.get("content-type") || "image/png";
      return res.type(contentType.includes("png") ? "png" : "jpeg").send(
        Buffer.from(await response.arrayBuffer())
      );
    } catch {
      return res.status(502).send("The map service could not be reached.");
    }
  });
  app.get("/api/ip-lookup", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const requestedIp =
        typeof req.query.ip === "string" && req.query.ip.length > 0
          ? normalizeIp(req.query.ip)
          : await getCurrentPublicIp(req);
      if (isIP(requestedIp) === 0)
        return res
          .status(400)
          .json({
            error: "That does not look like a valid IPv4 or IPv6 address.",
          });
      if (isPrivateOrReserved(requestedIp))
        return res
          .status(400)
          .json({
            error:
              "Private, loopback, reserved, and documentation IP addresses cannot be geolocated publicly. Try a public IP address.",
          });
      const result = await lookupIp(requestedIp);
      return res.json(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The lookup failed. Please try again.";
      return res.status(502).json({ error: message });
    }
  });
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`Server listening on port ${port}`)
  );
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
