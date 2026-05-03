const WebSocket = require('ws');
const http = require('http');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync.js');
const awarenessProtocol = require('y-protocols/awareness.js');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const map = require('lib0/map');

const PORT = process.env.PORT || 8081;
const ROOMS_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Map to store active documents and rooms
const docs = new Map();
const awareness = new Map();
const docStates = new Map();

class Room {
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.conns = new Set();
    this.createdAt = Date.now();
    
    this.setupAwareness();
    this.setupDocUpdateListener();
  }

  setupAwareness() {
    this.awareness.on('change', changes => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // Awareness update message type
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(changes)));
      
      const message = encoding.toUint8Array(encoder);
      this.broadcastMessage(message, null);
    });
  }

  setupDocUpdateListener() {
    this.doc.on('update', (update, origin) => {
      if (origin !== 'local') return;
      
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // Document update message type
      encoding.writeVarUint8Array(encoder, update);
      
      const message = encoding.toUint8Array(encoder);
      this.broadcastMessage(message, null);
    });
  }

  addConnection(conn) {
    this.conns.add(conn);
  }

  removeConnection(conn) {
    this.conns.delete(conn);
  }

  broadcastMessage(message, exclude) {
    for (const conn of this.conns) {
      if (conn !== exclude && conn.readyState === WebSocket.OPEN) {
        conn.send(message);
      }
    }
  }

  isEmpty() {
    return this.conns.size === 0;
  }

  cleanup() {
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// Get or create a room
function getRoom(name) {
  if (!docs.has(name)) {
    docs.set(name, new Room(name));
  }
  return docs.get(name);
}

// Handle WebSocket connection
function handleConnection(ws, req) {
  const url = req.url;
  const match = url.match(/\/rt\?id=([^&]+)/);
  
  if (!match) {
    ws.close(1008, 'Invalid room ID');
    return;
  }

  const roomId = match[1];
  const room = getRoom(roomId);
  
  console.log(`[${new Date().toISOString()}] Client connected to room: ${roomId}`);
  room.addConnection(ws);

  // Send initial state to client
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // Document update
  const update = Y.encodeStateAsUpdate(room.doc);
  encoding.writeVarUint8Array(encoder, update);
  ws.send(encoding.toUint8Array(encoder));

  // Send awareness states
  const awarenessEncoder = encoding.createEncoder();
  encoding.writeVarUint(awarenessEncoder, 1); // Awareness update
  encoding.writeVarUint8Array(
    awarenessEncoder,
    awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys()))
  );
  ws.send(encoding.toUint8Array(awarenessEncoder));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === 0) {
        // Document update
        const update = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(room.doc, update, 'remote');
      } else if (messageType === 1) {
        // Awareness update
        const awarenessUpdate = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, awarenessUpdate, 'remote');
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing message:`, error);
      ws.close(1011, 'Server error');
    }
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected from room: ${roomId}`);
    room.removeConnection(ws);

    // Clean up empty rooms
    if (room.isEmpty() && Date.now() - room.createdAt > 60000) {
      docs.delete(roomId);
      room.cleanup();
      console.log(`[${new Date().toISOString()}] Room cleaned up: ${roomId}`);
    }
  });

  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
  });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rooms: docs.size,
      totalConnections: Array.from(docs.values()).reduce((sum, room) => sum + room.conns.size, 0),
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });
wss.on('connection', handleConnection);

// Periodic cleanup of empty rooms
setInterval(() => {
  for (const [roomId, room] of docs.entries()) {
    if (room.isEmpty() && Date.now() - room.createdAt > ROOMS_CLEANUP_INTERVAL) {
      docs.delete(roomId);
      room.cleanup();
      console.log(`[${new Date().toISOString()}] Cleaned up inactive room: ${roomId}`);
    }
  }
}, ROOMS_CLEANUP_INTERVAL);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Real-time server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/rt?id=<room-id>`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  
  for (const [roomId, room] of docs.entries()) {
    room.cleanup();
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
