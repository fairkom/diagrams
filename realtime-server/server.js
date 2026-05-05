import { WebSocketServer } from 'ws';
import http from 'http';
import url from 'url';

const PORT = process.env.PORT || 8081;

// Store rooms and their connected WebSocket clients
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.updates = []; // Track update history with version IDs
    this.updateCount = 0; // Sequential counter for update versions
    this.createdAt = Date.now();
  }

  addUpdate(msg, sid) {
    this.updateCount++;
    const update = {
      id: this.updateCount,
      msg: msg,
      sid: sid,
      timestamp: Date.now()
    };
    this.updates.push(update);
    
    // Keep only last 100 updates to avoid memory leak
    if (this.updates.length > 100) {
      this.updates.shift();
    }
    
    console.log(`[${new Date().toISOString()}] [UPDATE] Room ${this.id} update #${this.updateCount} added (${msg.length} bytes)`);
    return update;
  }

  getUpdatesSince(lastSeenId) {
    if (lastSeenId === undefined || lastSeenId === null) {
      // Return only the latest update if no lastSeenId
      const latest = room.updates.length ? [room.updates[room.updates.length - 1]] : [];
      res.end(JSON.stringify(latest.length ? latest[0] : {})); // single object, not array
    } else {
      res.end(JSON.stringify(room.getUpdatesSince(lastSeenId)));
    }
    
    // Return all updates after lastSeenId
    const newUpdates = this.updates.filter(u => u.id > lastSeenId);
    console.log(`[${new Date().toISOString()}] [POLL] Client polling lastSeenId=${lastSeenId}, returning ${newUpdates.length} new updates`);
    return newUpdates;
  }

  addClient(ws) {
    this.clients.add(ws);
    console.log(`[${new Date().toISOString()}] Client added to room ${this.id}, total clients: ${this.clients.size}`);
  }

  removeClient(ws) {
    this.clients.delete(ws);
    console.log(`[${new Date().toISOString()}] Client removed from room ${this.id}, total clients: ${this.clients.size}`);
  }

  broadcast(message, excludeWs = null) {
    const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
    let count = 0;
    for (const client of this.clients) {
      if (client !== excludeWs && client.readyState === 1) { // OPEN
        try {
          client.send(msgStr);
          count++;
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error broadcasting:`, error.message);
        }
      }
    }
    if (count > 0) {
      console.log(`[${new Date().toISOString()}] Broadcast to ${count} clients in room ${this.id}`);
    }
  }
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Room(roomId));
    console.log(`[${new Date().toISOString()}] Created room: ${roomId}`);
  }
  return rooms.get(roomId);
}

// WebSocket connection handler
function handleWebSocket(ws, req) {
  const queryUrl = url.parse(req.url, true);
  const roomId = queryUrl.query.id;
  
  console.log(`[${new Date().toISOString()}] [WS-CONNECT] URL: ${req.url}`);
  console.log(`[${new Date().toISOString()}] [WS-CONNECT] User-Agent: ${req.headers['user-agent']}`);
  console.log(`[${new Date().toISOString()}] [WS-CONNECT] Origin: ${req.headers.origin}`);

  if (!roomId) {
    console.warn(`[${new Date().toISOString()}] WebSocket connection without room ID`);
    ws.close(1008, 'Missing room ID');
    return;
  }

  const room = getOrCreateRoom(roomId);
  room.addClient(ws);
  console.log(`[${new Date().toISOString()}] [WS-CONNECT] Successfully added client to room ${roomId}`);

  // Send last update to newly connected client with all metadata
  if (room.updates.length > 0) {
    try {
      const lastUpdate = room.updates[room.updates.length - 1];
      const wsMessage = JSON.stringify({
        msg: lastUpdate.msg
      });
      ws.send(wsMessage);
      console.log(`[${new Date().toISOString()}] [WS-SEND] Sent cached update #${lastUpdate.id} with metadata to new client in room ${roomId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WS-ERROR] Error sending cached update:`, error.message);
    }
  }

  // Handle incoming WebSocket messages
  ws.on('message', (data) => {
    try {
      console.log(`[${new Date().toISOString()}] [WS-MSG-IN] Received message from client in room ${roomId} (${data.length} bytes)`);
      
      // Broadcast to other clients
      room.broadcast(data, ws);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WS-MSG-ERROR] Error handling message:`, error.message);
    }
  });

  ws.on('close', () => {
    room.removeClient(ws);
    console.log(`[${new Date().toISOString()}] [WS-CLOSE] Client disconnected from room ${roomId}`);
  });

  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] [WS-ERROR] WebSocket error:`, error.message);
  });
}

// HTTP request handler
function handleRequest(req, res) {
  // Log EVERY request
  console.log(`[${new Date().toISOString()}] [HTTP] ${req.method} ${req.url} from ${req.headers['user-agent']?.substring(0, 50)}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
    return;
  }

  // Statistics
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const stats = {
      rooms: rooms.size,
      totalClients: Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  // Cache endpoint - draw.io sends/retrieves updates here
  if (req.url.startsWith('/cache')) {
    if (req.method === 'POST') {
      let body = '';

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          // Parse form data
          const params = new URLSearchParams(body);
          const roomId = params.get('id');
          const msg = params.get('msg');
          const sid = params.get('sid');

          if (!roomId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing room ID' }));
            return;
          }

          const room = getOrCreateRoom(roomId);

          // Store and broadcast the update
          if (msg) {
            const update = room.addUpdate(msg, sid);

            console.log(`[${new Date().toISOString()}] Cache update for room ${roomId} (${msg.length} bytes)`);
            console.log(`[${new Date().toISOString()}] Room ${roomId} has ${room.clients.size} WebSocket clients`);

            // Broadcast to WebSocket clients
            // Include all fields from the original POST: id, msg, sid - but we remove those as internal handler only expects msg
            let broadcastCount = 0;
            
            // Send complete update with all metadata
            const wsMessage = JSON.stringify({
              msg: msg
            });
            
            console.log(`[${new Date().toISOString()}] Sending complete update JSON (${wsMessage.length} chars, msg=${msg.substring(0, 30)}...) to ${room.clients.size} clients`);
            
            for (const client of room.clients) {
              if (client.readyState === 1) {
                try {
                  client.send(wsMessage);
                  broadcastCount++;
                  console.log(`[${new Date().toISOString()}] [DEBUG] Sent update to client (${broadcastCount}/${room.clients.size})`);
                } catch (error) {
                  console.error(`[${new Date().toISOString()}] [ERROR] Failed to send:`, error.message);
                }
              }
            }
            console.log(`[${new Date().toISOString()}] Broadcasted update #${update.id} to ${broadcastCount}/${room.clients.size} clients`);
          }

          // CRITICAL: Respond immediately with success
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ msg: msg, id: roomId, sid: sid }));
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error handling cache POST:`, error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server error' }));
        }
      });
    } else if (req.method === 'GET') {
      // GET /cache?id=roomId&lastId=X - retrieve cached updates for polling clients
      const queryParams = new URL(`http://${req.headers.host}${req.url}`).searchParams;
      const roomId = queryParams.get('id');
      const lastId = queryParams.get('lastId') ? parseInt(queryParams.get('lastId')) : null;

      console.log(`[${new Date().toISOString()}] [GET /cache] roomId=${roomId}, lastId=${lastId}`);

      if (!roomId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing room ID' }));
        return;
      }

      const room = getOrCreateRoom(roomId);
      const newUpdates = room.getUpdatesSince(lastId);

      if (newUpdates.length > 0) {
        // Return ALL new updates, not just the latest
        const updates = newUpdates.map(u => ({
          id: u.id,
          msg: u.msg,
          sid: u.sid,
          timestamp: u.timestamp
        }));
        
        console.log(`[${new Date().toISOString()}] [GET /cache] Returning ${updates.length} new updates for room ${roomId}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updates));
      } else {
        console.log(`[${new Date().toISOString()}] [GET /cache] No updates since ${lastId} for room ${roomId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
    return;
  }

  // List rooms
  if (req.url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
      id,
      clients: room.clients.size,
      createdAt: room.createdAt
    }));
    res.end(JSON.stringify(roomList, null, 2));
    return;
  }

  // Not found
  res.writeHead(404);
  res.end();
}

// Create HTTP server
const server = http.createServer(handleRequest);

// Create WebSocket server
const wss = new WebSocketServer({ server });
wss.on('connection', handleWebSocket);

// Cleanup empty rooms every 5 minutes
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.clients.size === 0 && Date.now() - room.createdAt > 5 * 60 * 1000) {
      rooms.delete(roomId);
      console.log(`[${new Date().toISOString()}] Cleaned up empty room: ${roomId}`);
    }
  }
}, 5 * 60 * 1000);

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Real-time server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/rt?id=<room-id>`);
  console.log(`HTTP Cache endpoint: http://0.0.0.0:${PORT}/cache`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Closing server...');
  
  for (const room of rooms.values()) {
    for (const client of room.clients) {
      client.close(1000, 'Server shutting down');
    }
  }

  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Shutdown] Forced exit');
    process.exit(1);
  }, 10000);
});
