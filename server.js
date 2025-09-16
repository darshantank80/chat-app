const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAX_PER_ROOM = 100;
const MAX_MSG_LEN = 2000;
const MSG_LIMIT = 5; // max messages per window
const LIMIT_WINDOW = 10_000; // 10s window

let rooms = {}; // { roomCode: { sockets: Set } }
let rateLimits = {}; // { socket.id: [timestamps] }

function ensureRoom(room) {
  if (!rooms[room]) rooms[room] = { sockets: new Set() };
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function withinRateLimit(socketId) {
  const now = Date.now();
  if (!rateLimits[socketId]) rateLimits[socketId] = [];
  // keep only recent
  rateLimits[socketId] = rateLimits[socketId].filter((t) => now - t < LIMIT_WINDOW);
  if (rateLimits[socketId].length >= MSG_LIMIT) return false;
  rateLimits[socketId].push(now);
  return true;
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // assign random avatar color
  const colors = [
    "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5",
    "#2196f3", "#009688", "#4caf50", "#ff9800", "#795548"
  ];
  socket.data.avatarColor = colors[Math.floor(Math.random() * colors.length)];

  socket.on("createRoom", (cb) => {
    try {
      let code;
      do code = generateCode();
      while (rooms[code]);
      ensureRoom(code);
      rooms[code].sockets.add(socket.id);
      socket.join(code);
      socket.data.room = code;
      cb && cb({ ok: true, room: code, count: rooms[code].sockets.size });
      io.to(code).emit("roomUsers", { count: rooms[code].sockets.size });
    } catch {
      cb && cb({ ok: false, error: "Server error creating room" });
    }
  });

  socket.on("joinRoom", (roomCode, cb) => {
    try {
      if (!roomCode) return cb && cb({ ok: false, error: "Missing code" });
      roomCode = String(roomCode).toUpperCase();
      ensureRoom(roomCode);
      if (rooms[roomCode].sockets.size >= MAX_PER_ROOM)
        return cb && cb({ ok: false, error: "Room full" });

      rooms[roomCode].sockets.add(socket.id);
      socket.join(roomCode);
      socket.data.room = roomCode;
      cb && cb({ ok: true, room: roomCode, count: rooms[roomCode].sockets.size });
      io.to(roomCode).emit("roomUsers", { count: rooms[roomCode].sockets.size });
      io.to(roomCode).emit("systemMessage", `${socket.id} joined`);
    } catch {
      cb && cb({ ok: false, error: "Server error joining room" });
    }
  });

  socket.on("message", (payload, cb) => {
    try {
      const room = socket.data.room;
      if (!room) return cb && cb({ ok: false, error: "Not in room" });
      if (!withinRateLimit(socket.id))
        return cb && cb({ ok: false, error: "Rate limit exceeded" });

      const text =
        payload && payload.text
          ? String(payload.text).slice(0, MAX_MSG_LEN)
          : "";
      if (!text) return cb && cb({ ok: false, error: "Empty message" });

      const msg = {
        from: socket.id,
        text,
        ts: Date.now(),
        avatarColor: socket.data.avatarColor,
      };
      socket.to(room).emit("message", msg);
      cb && cb({ ok: true, msg });
    } catch {
      cb && cb({ ok: false, error: "Server error sending message" });
    }
  });

  socket.on("leaveRoom", (cb) => {
    try {
      const room = socket.data.room;
      if (room && rooms[room]) {
        rooms[room].sockets.delete(socket.id);
        socket.leave(room);
        io.to(room).emit("roomUsers", { count: rooms[room].sockets.size });
        io.to(room).emit("systemMessage", `${socket.id} left`);
        if (rooms[room].sockets.size === 0) delete rooms[room];
        socket.data.room = null;
        cb && cb({ ok: true });
      } else cb && cb({ ok: false, error: "Not in room" });
    } catch {
      cb && cb({ ok: false, error: "Server error leaving room" });
    }
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    if (room && rooms[room]) {
      rooms[room].sockets.delete(socket.id);
      io.to(room).emit("roomUsers", { count: rooms[room].sockets.size });
      io.to(room).emit("systemMessage", `${socket.id} disconnected`);
      if (rooms[room].sockets.size === 0) delete rooms[room];
    }
    delete rateLimits[socket.id];
    console.log("Disconnected:", socket.id);
  });
});

// Serve UI
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
