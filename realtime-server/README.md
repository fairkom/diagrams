# draw.io Real-Time Server

A lightweight Node.js WebSocket + HTTP server that enables real-time collaborative editing for self-hosted draw.io embedded in Nextcloud.

## How It Works

draw.io's realtime protocol has two channels:

1. **HTTP `/cache`** — draw.io POSTs an AES-encrypted diagram snapshot after every save. Other clients GET this endpoint to poll for missed updates.
2. **WebSocket `/rt`** — our custom relay channel. `PreConfig.js` (injected into draw.io) sends plain-text diagram XML here on every model change. The server broadcasts it to all other tabs in the same room.

When a tab connects late, the server sends `room.lastXml` (the last plain XML it received) immediately on WebSocket open, so the tab instantly has the current diagram state without waiting for Nextcloud to push an update.

## Endpoints

| Path | Protocol | Description |
|---|---|---|
| `/rt?id=<roomId>` | WebSocket | Real-time relay room |
| `/cache` | HTTP POST | Store encrypted diagram snapshot |
| `/cache?id=&sid=` | HTTP GET | Retrieve latest snapshot |
| `/health` | HTTP GET | Liveness probe — returns `OK` |
| `/stats` | HTTP GET | JSON: rooms, clients, uptime |
| `/rooms` | HTTP GET | JSON: list of active rooms |

## Message Format

**Client → Server (WebSocket)**
```json
{ "type": "xml", "xml": "<mxGraphModel>...</mxGraphModel>" }
```

**Server → Client (WebSocket, broadcast)**

Same `{type:"xml", xml:"..."}` object — all clients in the room except the sender receive it.

**Server → newly connected Client (WebSocket, initial state)**

If `room.lastXml` exists: `{type:"xml", xml:"..."}` (plain, decoded immediately by client)
Otherwise: `{msg:"<base64-encrypted>"}` (draw.io's HTTP cache, requires AES key the client holds)

## Room Lifecycle

- A room is created on first WebSocket connection or HTTP POST for a given `id`.
- `room.lastXml` is updated every time a client sends a `{type:"xml"}` WebSocket message.
- Rooms with no connected clients are garbage-collected after 5 minutes.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | Listening port |

## Building

```bash
docker build -t registry.osalliance.com/drawio/drawio-realtime:vX.X.X .
docker push registry.osalliance.com/drawio/drawio-realtime:vX.X.X
```

Update the image tag in `../base/realtime-server-deployment.yaml`, then apply:

```bash
kubectl apply -f ../base/realtime-server-deployment.yaml
```

## Running Locally

```bash
npm install
node server.js
```

The server listens on `0.0.0.0:8081`. For local testing with draw.io, use an ngrok tunnel or a port-forward:

```bash
kubectl port-forward service/drawio-realtime 8081:8081
```

## Kubernetes Resources

| Resource | Value |
|---|---|
| Memory request | 128 Mi |
| Memory limit | 512 Mi |
| CPU request | 100 m |
| CPU limit | 500 m |
| Liveness probe | `GET /health` every 30 s |
| Readiness probe | `GET /health` every 10 s |

## License

Apache 2.0
