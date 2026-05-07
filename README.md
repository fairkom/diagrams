# draw.io for Kubernetes + Nextcloud

A self-hosted [draw.io](https://www.diagrams.net) deployment for Kubernetes, with GDPR-compliant real-time collaborative editing designed for use inside Nextcloud.

## Overview

draw.io is deployed as the `jgraph/drawio` container behind Tomcat. A companion Node.js service handles real-time collaboration, replacing draw.io's default dependency on Pusher.com (a US cloud service) with a self-hosted WebSocket server.

The integration is designed for the Nextcloud draw.io app, where draw.io runs inside an iframe embedded in Nextcloud (`embedRT=1` mode).

## Features

- Create and edit diagrams online
- Support for flowcharts, UML, entity relationships, and more
- **Real-time collaborative editing** with separate rt server
- Export to multiple formats (PNG, SVG, PDF, etc.)
- Self-hosted and privacy-focused


## Architecture

```
Nextcloud (test.faircloud.eu)
  └── <iframe> draw.io (drawio-dev.fairkom.net)
         │
         │  WebSocket (wss://.../rt)
         │  HTTP POST/GET (https://.../cache)
         ▼
  drawio-realtime (Node.js, port 8081)
         │
         ├── /rt   — WebSocket endpoint, relays plain XML between tabs
         └── /cache — HTTP endpoint, stores encrypted diagram snapshots
```

**How real-time sync works:**

1. `PreConfig.js` is injected into draw.io's `index.html` at pod startup (via ConfigMap).
2. It installs a Pusher shim (`window.Pusher`) so draw.io's RT initialization completes without making any Pusher.com network requests.
3. It patches `mxGraph`'s model change listener. On every user edit, the full diagram XML is encoded with `mxCodec` and sent via WebSocket as `{type:"xml", xml:"..."}`.
4. The server broadcasts this to all other connected tabs and caches it as `room.lastXml`.
5. Receiving tabs apply the XML directly with `mxCodec.decode(...)`, updating cell positions without a page reload.
6. Tabs that connect late receive `room.lastXml` immediately on WebSocket open.

## Repository Structure

```
drawio/
├── base/
│   ├── configmap.yaml              # draw.io config + PreConfig.js (the RT shim)
│   ├── deployment.yaml             # draw.io pod (injects PreConfig.js at startup)
│   ├── realtime-server-deployment.yaml
│   ├── realtime-server-service.yaml
│   ├── ingress.yaml                # routes /rt and /cache to realtime service
│   └── kustomization.yaml
├── overlay/
│   └── dev/
│       └── kustomization.yaml
├── realtime-server/
│   ├── server.js                   # Node.js WebSocket + HTTP server
│   ├── package.json
│   ├── Dockerfile
│   └── README.md
├── CHALLENGES.md                   # Engineering history: what was tried and why
└── IMAGE_DEPLOYMENT.md             # How to build and push the realtime-server image
```

## Deployment

### Prerequisites

- Kubernetes cluster with an Nginx ingress controller
- A private container registry (e.g. `registry.osalliance.com`)
- `kubectl` with access to the target namespace

### 1. Build and push the real-time server image

```bash
cd realtime-server
docker build -t registry.osalliance.com/drawio/drawio-realtime:vX.X.X .
docker push registry.osalliance.com/drawio/drawio-realtime:vX.X.X
```

Update the image tag in `base/realtime-server-deployment.yaml`.

### 2. Apply the manifests

```bash
kubectl apply -f base/configmap.yaml
kubectl apply -k overlay/dev
```

### 3. Updating PreConfig.js

`PreConfig.js` lives inside `base/configmap.yaml` under the `PreConfig.js:` key. After editing:

```bash
kubectl apply -f base/configmap.yaml
kubectl rollout restart deployment/drawio
```

The draw.io pod's startup command copies the ConfigMap-mounted file into Tomcat's webapp directory on every restart.

## Nextcloud Integration

In the Nextcloud admin panel (draw.io app settings), replace the default server URL:

- Default: `https://embed.diagrams.net`
- Self-hosted: `https://drawio-dev.fairkom.net`

Ensure the draw.io app is configured with `embedRT=1` to enable real-time mode. Do not activate offline mode but activate automatic saving. 

## API Endpoints (realtime-server)

| Endpoint | Method | Description |
|---|---|---|
| `/rt?id=<roomId>` | WebSocket | Real-time relay — clients send/receive `{type:"xml", xml:"..."}` |
| `/cache` | POST | draw.io stores encrypted diagram snapshot: `id=&sid=&msg=` |
| `/cache` | GET | draw.io polls for latest snapshot: `?id=&sid=` |
| `/health` | GET | Liveness/readiness probe |
| `/stats` | GET | JSON: room count, connected clients, uptime |

## Configuration

The draw.io ConfigMap (`base/configmap.yaml`) contains:

- `drawio-config.json` — sets `realtimeUrl` and `pusherKey: "local-rt"`
- `PreConfig.js` — the RT shim loaded before draw.io's `app.min.js`
- `templates.xml` — custom diagram templates

## Troubleshooting

**WebSocket not connecting**
- Verify the ingress routes `/rt` (with WebSocket upgrade headers) to the `drawio-realtime` service.
- Check: `kubectl logs deployment/drawio-realtime`

**PreConfig.js not loading**
- Check that the draw.io pod startup logs show `Injected PreConfig.js into index.html`.
- Verify the ConfigMap is mounted correctly.

**Objects not syncing**
- Open browser console and check for `[DrawIO RT] Ready` on startup and `[DrawIO RT] Sent XML` on edits.
- If `Sent XML` appears but the other tab shows nothing, check the ingress WebSocket timeout (set `proxy-read-timeout` to at least 3600).

## License

Apache 2.0

## Author

Roland Alton
