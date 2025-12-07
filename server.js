#!/usr/bin/env node

import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import fetch from "node-fetch";

const PORT = process.env.PORT || 3000;

// Map subdomain -> client WebSocket
const clients = {};

const server = http.createServer(async (req, res) => {
  const hostHeader = req.headers.host;
  if (!hostHeader) {
    res.writeHead(400);
    return res.end("Bad Request");
  }

  const subdomain = hostHeader.split(".")[0];
  const client = clients[subdomain];

  if (!client) {
    res.writeHead(404);
    return res.end(`No client registered for subdomain '${subdomain}'`);
  }

  // Forward HTTP request to client
  const payload = JSON.stringify({
    type: "request",
    method: req.method,
    headers: req.headers,
    url: req.url,
  });

  client.send(payload);

  const onResponse = (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === "response" && data.url === req.url) {
        res.writeHead(data.statusCode, data.headers);
        res.end(Buffer.from(data.body, "base64"));
        client.off("message", onResponse);
      }
    } catch (err) {
      console.error("Error parsing client response:", err);
    }
  };

  client.on("message", onResponse);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "register" && data.subdomain) {
        clients[data.subdomain] = ws;
        console.log(`[Server] Client registered: ${data.subdomain}`);
      }
    } catch (err) {
      console.error("Invalid message:", err);
    }
  });

  ws.on("close", () => {
    for (const sub in clients) {
      if (clients[sub] === ws) {
        console.log(`[Server] Client disconnected: ${sub}`);
        delete clients[sub];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Server] Splannes relay server running on port ${PORT}`);

  // Self-ping interval: every 4 minutes
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${PORT}`);
      console.log(`[Server] Self-ping sent to keep server awake.`);
    } catch (err) {
      console.error(`[Server] Self-ping failed: ${err.message}`);
    }
  }, 4 * 60 * 1000); // 4 minutes
});
