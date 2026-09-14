import http from "node:http";
import net from "node:net";
import { egressProxy } from "./network.js";
/** This gateway is on one private worker network; only worker protocol routes reach the core. */
export function gateway(coreUrl: string, relayPort = 18881, proxyPort = 18880) {
  const core = new URL(coreUrl);
  if (core.protocol !== "http:")
    throw new Error("Gateway core transport must be a private HTTP endpoint");
  const allowed = (url: string) => {
    try {
      const u = new URL(url, "http://gateway");
      return (
        /^\/v1\/worker\/(connect|artifacts(?:\/art_[a-f0-9]{32})?|learnings)$/.test(
          u.pathname,
        ) &&
        !url.includes("%") &&
        !url.includes("..")
      );
    } catch {
      return false;
    }
  };
  const server = http.createServer((req, res) => {
    if (!allowed(req.url || "")) {
      res.writeHead(403);
      res.end("CONTROL_ROUTE_DENIED");
      return;
    }
    const upstream = http.request(
      {
        hostname: core.hostname,
        port: Number(core.port || 80),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: core.host },
      },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/v1/worker/connect") {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(
      { host: core.hostname, port: Number(core.port || 80) },
      () => {
        const headers = { ...req.headers, host: core.host };
        upstream.write(
          `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\r\n") +
            "\r\n\r\n",
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      },
    );
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  server.listen(relayPort, "0.0.0.0");
  const proxy = egressProxy(proxyPort, "0.0.0.0");
  return {
    close() {
      server.close();
      proxy.close();
    },
  };
}
