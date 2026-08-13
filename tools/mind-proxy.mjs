#!/usr/bin/env node
/**
 * mind-proxy - a 90-line CORS shim so the phone brain can reach Ollama Cloud.
 *
 * WHY THIS EXISTS
 * A web page on your phone cannot always call https://ollama.com/v1 directly:
 * browsers require the server to opt in with CORS headers, and an API vendor
 * that does not expect browser traffic usually does not. Nothing is wrong with
 * your key when you see "Failed to fetch" - the request never left.
 *
 * Run this on any machine on your Wi-Fi (laptop, Pi, NAS) and point the app's
 * base url at http://<that machine>:8787/v1. It adds the CORS headers, adds
 * your API key, and streams everything else straight through.
 *
 * As a bonus, the key lives here rather than in a web page on a phone that
 * might get handed to someone else.
 *
 *   export OLLAMA_API_KEY=...        # from https://ollama.com/settings/keys
 *   node mind-proxy.mjs              # localhost only
 *
 *   # to let a phone on the LAN connect, require a separate client token:
 *   HOST=0.0.0.0 OWLBOT_PROXY_TOKEN=use-a-long-random-value node mind-proxy.mjs
 *
 *   # point it somewhere else entirely:
 *   UPSTREAM=http://192.168.1.9:11434/v1 node mind-proxy.mjs
 *
 * Requires Node 18+ (built-in fetch). No dependencies.
 */

import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const UPSTREAM = (process.env.UPSTREAM || "https://ollama.com/v1").replace(/\/$/, "");
const KEY = process.env.OLLAMA_API_KEY || process.env.API_KEY || "";
const CLIENT_TOKEN = process.env.OWLBOT_PROXY_TOKEN || process.env.GROWBOT_PROXY_TOKEN || "";
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024);
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

if (!LOOPBACK.has(HOST) && !CLIENT_TOKEN) {
  console.error("Refusing a non-loopback listener without OWLBOT_PROXY_TOKEN.");
  process.exit(1);
}

function hasClientToken(header) {
  if (!CLIENT_TOKEN) return true;
  const supplied = String(header || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(CLIENT_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  // Only proxy the OpenAI-compatible surface. Anything else gets a hint.
  const m = /^\/v1(\/.*)?$/.exec(req.url.split("?")[0]);
  if (!m) {
    res.writeHead(404, { ...CORS, "Content-Type": "text/plain" });
    return res.end(
      "owlbot mind-proxy\n\n" +
      "point the app's base url at  http://<this host>:" + PORT + "/v1\n" +
      "upstream: " + UPSTREAM + "\n" +
      "key: " + (KEY ? "loaded from env" : "NOT SET - export OLLAMA_API_KEY") + "\n"
    );
  }

  if (!hasClientToken(req.headers.authorization)) {
    res.writeHead(401, {
      ...CORS,
      "Content-Type": "application/json",
      "WWW-Authenticate": "Bearer",
    });
    return res.end(JSON.stringify({ error: { message: "invalid proxy token" } }));
  }

  if (!["GET", "HEAD", "POST"].includes(req.method)) {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "method not allowed" } }));
  }

  const target = UPSTREAM + (m[1] || "") + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");

  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { ...CORS, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "request body too large" } }));
      }
      chunks.push(c);
    }
    body = Buffer.concat(chunks);
  }

  const headers = {
    "Content-Type": req.headers["content-type"] || "application/json",
    "Accept": req.headers.accept || "application/json",
  };
  // A client token authenticates to this proxy; it is never sent upstream.
  if (KEY) headers.Authorization = "Bearer " + KEY;

  const t0 = Date.now();
  try {
    const up = await fetch(target, { method: req.method, headers, body });
    console.log(`${req.method} ${m[1] || "/"} -> ${up.status} ${Date.now() - t0}ms`);
    res.writeHead(up.status, {
      ...CORS,
      "Content-Type": up.headers.get("content-type") || "application/json",
    });
    if (!up.body || req.method === "HEAD") return res.end();
    Readable.fromWeb(up.body).pipe(res);
  } catch (e) {
    console.error("upstream failed:", e.message);
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "upstream: " + e.message } }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`owlbot mind-proxy  ${HOST}:${PORT}  ->  ${UPSTREAM}`);
  console.log(KEY ? "api key loaded from environment" : "WARNING: no OLLAMA_API_KEY set");
  console.log(CLIENT_TOKEN ? "client token required" : "client token not required on loopback");
  console.log(`set the app's base url to  http://<this machine>:${PORT}/v1`);
});
