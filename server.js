const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let rooms = {}; // { roomCode: [socketIds...] }

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create room
  socket.on("createRoom", () => {
    const code = generateCode();
    rooms[code] = [socket.id];
    socket.join(code);
    socket.emit("roomCreated", code);
    console.log(`Room ${code} created by ${socket.id}`);
  });

  // Join room
  socket.on("joinRoom", (roomCode) => {
    if (!rooms[roomCode]) {
      rooms[roomCode] = [];
    }
    rooms[roomCode].push(socket.id);
    socket.join(roomCode);

    socket.to(roomCode).emit("system", `🔔 Someone joined room ${roomCode}`);
    socket.emit("joined", roomCode);
  });

  // Relay chat messages (volatile, no storage)
  socket.on("chatMessage", ({ roomCode, msg }) => {
    socket.to(roomCode).emit("message", `Anonymous: ${msg}`);
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    for (let room in rooms) {
      rooms[room] = rooms[room].filter((id) => id !== socket.id);
      if (rooms[room].length === 0) delete rooms[room];
    }
    console.log("User disconnected:", socket.id);
  });
});

// serve the frontend
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
