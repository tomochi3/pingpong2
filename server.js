const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "0.0.0.0";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

let nextClientId = 1;
const clients = new Map();

function localAddresses() {
  const addresses = [];
  Object.values(os.networkInterfaces()).forEach((interfaces) => {
    interfaces.forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    });
  });
  return addresses;
}

function publicClientList() {
  return Array.from(clients.values()).map((client) => ({
    id: client.id,
    side: client.side,
    host: client.host,
  }));
}

function assignSide() {
  const usedSides = new Set(Array.from(clients.values()).map((client) => client.side));
  if (!usedSides.has("left")) return "left";
  if (!usedSides.has("right")) return "right";
  return "spectator";
}

function sendFrame(socket, data) {
  const payload = Buffer.from(data);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function sendJson(client, message) {
  if (client.socket.destroyed) return;
  sendFrame(client.socket, JSON.stringify(message));
}

function broadcast(message, exceptId = null) {
  clients.forEach((client) => {
    if (client.id !== exceptId) {
      sendJson(client, message);
    }
  });
}

function broadcastPeers() {
  broadcast({ type: "peers", clients: publicClientList() });
}

function parseFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) break;
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const totalLength = headerLength + maskLength + length;
    if (offset + totalLength > buffer.length) break;

    if (opcode === 0x8) {
      messages.push({ close: true });
    } else if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
      const dataStart = offset + headerLength + maskLength;
      const payload = Buffer.from(buffer.subarray(dataStart, dataStart + length));
      if (mask) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }
      messages.push({ text: payload.toString("utf8") });
    }

    offset += totalLength;
  }

  return messages;
}

function handleMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === "input") {
    broadcast({
      type: "input",
      id: client.id,
      side: client.side,
      input: message.input,
      at: Date.now(),
    }, client.id);
    return;
  }

  if (message.type === "snapshot" && client.host) {
    broadcast({
      type: "snapshot",
      id: client.id,
      side: client.side,
      snapshot: message.snapshot,
      at: Date.now(),
    }, client.id);
    return;
  }

  if (message.type === "control") {
    broadcast({
      type: "control",
      id: client.id,
      side: client.side,
      action: message.action,
      at: Date.now(),
    }, client.host ? client.id : null);
  }
}

function removeClient(id) {
  const client = clients.get(id);
  if (!client) return;
  clients.delete(id);
  broadcast({ type: "leave", id, side: client.side });
  broadcastPeers();
}

function serveFile(req, res) {
  if (req.url === "/api/network-info" || req.url === "/lan-info.json") {
    const addresses = localAddresses();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      enabled: true,
      port: PORT,
      urls: addresses.map((address) => `http://${address}:${PORT}/`),
    }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(serveFile);

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));

  const id = nextClientId;
  nextClientId += 1;
  const side = assignSide();
  const client = {
    id,
    side,
    host: side === "left",
    socket,
  };
  clients.set(id, client);

  sendJson(client, {
    type: "welcome",
    id,
    side,
    host: client.host,
    urls: localAddresses().map((address) => `http://${address}:${PORT}/`),
    clients: publicClientList(),
  });
  broadcast({ type: "join", id, side, host: client.host }, id);
  broadcastPeers();

  socket.on("data", (buffer) => {
    parseFrames(buffer).forEach((frame) => {
      if (frame.close) {
        socket.end();
      } else if (frame.text) {
        handleMessage(client, frame.text);
      }
    });
  });
  socket.on("close", () => removeClient(id));
  socket.on("error", () => removeClient(id));
});

server.listen(PORT, HOST, () => {
  const urls = localAddresses().map((address) => `http://${address}:${PORT}/`);
  console.log(`Ping Pong LAN server listening on http://127.0.0.1:${PORT}/`);
  urls.forEach((url) => console.log(`LAN URL: ${url}`));
});
