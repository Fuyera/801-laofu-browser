import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import http from "node:http";
import net from "node:net";
import { Fault } from "./errors.js";
const configured = (process.env.LAOFU_PUBLIC_DNS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
if (configured.some((ip) => !net.isIP(ip)))
  throw new Error("LAOFU_PUBLIC_DNS requires DNS server IP addresses");
const publicResolver = configured.length
  ? new dns.Resolver({ timeout: 3000, tries: 2 })
  : null;
publicResolver?.setServers(configured);
export function publicAddress(address: string) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function publicTarget(host: string, port: number) {
  host = String(host || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    (!host.includes(".") && !net.isIP(host.replace(/^\[|\]$/g, ""))) ||
    host === "localhost"
  )
    throw new Fault("NETWORK_DENIED", "目标网络未授权", 403);
  const clean = host.replace(/^\[|\]$/g, "");
  const rows = net.isIP(clean)
    ? [{ address: clean }]
    : publicResolver
      ? (
          await Promise.allSettled([
            publicResolver.resolve4(clean),
            publicResolver.resolve6(clean),
          ])
        ).flatMap((r) =>
          r.status === "fulfilled"
            ? r.value.map((address) => ({ address }))
            : [],
        )
      : await dns.lookup(clean, { all: true });
  if (!rows.length || rows.some((r) => !publicAddress(r.address)))
    throw new Fault("NETWORK_DENIED", "私网或保留地址不可访问", 403);
  return rows[0].address;
}
export function egressProxy(port = 18880, host = "0.0.0.0") {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "");
      if (url.protocol !== "http:" || url.username || url.password)
        throw new Error("protocol");
      const target = await publicTarget(url.hostname, Number(url.port || 80));
      const headers: http.IncomingHttpHeaders = {
        ...req.headers,
        host: url.host,
      };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          hostname: target,
          port: Number(url.port || 80),
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        },
      );
      upstream.setTimeout(120000, () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("NETWORK_DENIED");
    }
  });
  server.on("connect", async (req, socket, head) => {
    try {
      const u = new URL("https://" + req.url);
      const target = await publicTarget(u.hostname, Number(u.port || 443));
      const remote = net.connect(
        { host: target, port: Number(u.port || 443) },
        () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) remote.write(head);
          socket.pipe(remote);
          remote.pipe(socket);
        },
      );
      remote.setTimeout(120000, () => remote.destroy());
      remote.on("error", () => socket.destroy());
      socket.on("error", () => remote.destroy());
      socket.on("close", () => remote.destroy());
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  server.listen(port, host);
  return server;
}
