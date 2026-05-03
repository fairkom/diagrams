# Draw.io Real-Time Collaboration Server

A Node.js WebSocket server that enables real-time collaborative editing for self-hosted draw.io deployments using Yjs (CRDT-based synchronization).

## Features

- **CRDT-based Synchronization**: Uses Yjs for conflict-free replicated data types
- **WebSocket Protocol**: Efficient real-time communication
- **Awareness Protocol**: Tracks presence of remote users
- **Automatic Cleanup**: Removes inactive rooms to save resources
- **Health Checks**: Built-in health and stats endpoints
- **Room Management**: Each diagram gets its own isolated room

## Architecture

```
Draw.io Client (WebSocket)
    ↓
Nginx Ingress (port 443, path /realtime)
    ↓
DrawIO-Realtime Service (port 8081)
    ↓
Node.js WebSocket Server (Yjs + lib0)
```

## Building

Build the Docker image:

```bash
cd realtime-server
docker build -t drawio-realtime:latest .
```

## Kubernetes Deployment

The real-time server is deployed as part of the standard kustomization:

```bash
cd overlay/dev
kubectl apply -k .
```

This creates:
- `drawio-realtime` Deployment
- `drawio-realtime` Service  
- `realtime-ingress` Ingress (routes `/realtime` path)

## API Endpoints

### WebSocket
- `ws://host:8081/rt?id=<room-id>` - Real-time collaboration endpoint

### HTTP
- `GET /health` - Health check
- `GET /stats` - Server statistics (JSON)

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | 8081 | WebSocket server port |

## Client Integration

The draw.io client automatically detects the real-time server via the `/realtime-init.html` configuration that's injected into the page. The client will:

1. Detect the domain and protocol
2. Connect to `wss://domain/realtime` (for HTTPS)
3. Exchange document updates via Yjs protocol
4. Sync awareness (user presence) information

## Protocol

The server uses the Yjs synchronization protocol:

- **Message Type 0**: Document updates (Y.encodeStateAsUpdate)
- **Message Type 1**: Awareness updates (user presence, cursors, selections)

Both are encoded using lib0's variable-length encoding for efficiency.

## Troubleshooting

### WebSocket Connection Failed
- Ensure Ingress is configured to proxy `/realtime` path to the service
- Check that `nginx.ingress.kubernetes.io/websocket-services` annotation includes proper timeout

### No Real-time Sync
- Check browser console for connection errors
- Verify the real-time server pod is running: `kubectl get pods -n drawio-dev`
- Check logs: `kubectl logs -f deployment/drawio-realtime -n drawio-dev`

### Memory Issues
- Monitor with: `kubectl top pods -n drawio-dev`
- Inactive rooms are auto-cleaned after 5 minutes
- Pod limits are set to 512Mi by default

## Development

Run locally with hot-reload:

```bash
npm install
npm run dev
```

Then expose the WebSocket to draw.io (e.g., via ngrok or localhost port forwarding).

## License

Apache 2.0
