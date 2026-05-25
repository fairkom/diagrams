# draw.io real-time server Nextcloud + Jitsi

A self-hosted [draw.io](https://www.diagrams.net) deployment for Kubernetes, with GDPR-compliant real-time collaborative editing designed for use inside Nextcloud or Jitsi but also stand-alone.

## Overview

draw.io is deployed as the `jgraph/drawio` container behind Tomcat. A companion Node.js service handles real-time collaboration, replacing draw.io's default dependency on Pusher.com (a US cloud service) with a self-hosted WebSocket server.

The integration is also designed for the Nextcloud draw.io app, where draw.io runs inside an iframe embedded in Nextcloud (`embedRT=1` mode) and for Jitsi.

## Features

- Create and edit diagrams online
- Support for flowcharts, UML, entity relationships, and more
- **Real-time collaborative editing** with separate rt server
- Export to multiple formats (PNG, SVG, PDF, etc.)
- When opened from Nextcloud show avatars moving around from all collaborators, else show names
- Requests display name from anonymous external users or fetch from Jitsi session
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
│   ├── drawio-configmap.yaml       # draw.io config + PreConfig.js (the RT shim)
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

We push to fairkom's public registry.

```bash
cd realtime-server
docker build -t registry.osalliance.com/drawio/drawio-realtime:vX.X.X .
docker push registry.osalliance.com/drawio/drawio-realtime:vX.X.X
```

Update the image tag in `base/realtime-server-deployment.yaml`.

### 2. Apply the manifests

```bash
kubectl apply -f base/drawio-configmap.yaml
kubectl apply -k overlay/dev
```

### 3. Configuration

Configurations and our custom logic live inside `base/drawio-configmap.yaml`. You need to adapt at least the realtimeUrl. After each edit do a:

```bash
kubectl apply -f base/drawio-configmap.yaml
kubectl rollout restart deployment/drawio
```

The draw.io pod's startup command copies the ConfigMap-mounted file into Tomcat's webapp directory on every restart.

The draw.io ConfigMap (`base/drawio-configmap.yaml`) contains:

- `drawio-config.json` — sets `realtimeUrl` and `pusherKey: "local-rt"`
- `PreConfig.js` — the RT shim loaded before draw.io's `app.min.js`
- `templates.xml` — custom diagram templates

If you want the full draw.io gallery with all 200+ templates instead, just change templateFile in drawio-config.json from /templates/templates.xml to /templates/index.xml.


## Share a diagram

Open the URL and start drawing. Use the share button to generate a link. Other users will have to enter their name so you can see their avatars. 

draw.io stores diagrams in the browser by default. We have patched the annoying storage dialog at startup and show a 💾 symbol to indicate, that you should store your diagram on some device or cloud service.

## Nextcloud Integration

This realtime server works well with the draw.io Nextcloud app. It even shows the Nexctloud user avatars.  

In the admin panel (draw.io app settings), replace the default server URL:

- Default: `https://embed.diagrams.net`
- Self-hosted: `https://drawio-dev.fairkom.net` 
- Demo diagram: `https://test.faircloud.eu/s/j6s89ZNpf2es7LX`

Ensure the draw.io app is configured with `embedRT=1` to enable real-time mode. Do not activate offline mode but activate automatic saving. 

## Jitsi Integration

draw.io can be used as a shared whiteboard inside a Jitsi video call by configuring it as the Etherpad provider.

### How it works

Jitsi's Etherpad integration opens a shared note pad as an iframe panel for all participants. By pointing Jitsi at this draw.io instance instead of Etherpad, participants get a real-time collaborative diagram instead of a text pad.

When someone opens the "Shared document" panel in Jitsi, Jitsi constructs a URL like:

```
https://drawio-dev.fairkom.net/myroom1?showControls=true&showChat=false&userName=Alice
```

The `PreConfig.js` shim detects the Etherpad-style query parameters (`showControls`, `showLineNumbers`, `useMonospaceFont`) and:

1. Treats the path segment (`myroom1`) as the collaboration room ID.
2. Extracts `userName=` from the URL and pre-fills the guest name — skipping the name popup.
3. Enables RT collaboration even though draw.io runs inside an iframe.
4. Adds a **🔗 Share** button inside the draw.io iframe so participants can copy the diagram link.

All participants in the same Jitsi room see the same diagram and edits are synced in real time.

Known issue: When a user opens a shared document, this action is not triggered to other users as it does with the whiteboard. Any user needs to choose that menu item, unless the moderator activates the moderation option “Follow me”.

### Jitsi configuration

In your Jitsi `config.js` (or environment config), set:

```js
etherpad_base: 'https://drawio-dev.fairkom.net/#rt=',
```

Or via environment variable for `docker-jitsi-meet`:

```bash
ETHERPAD_PUBLIC_URL='https://drawio-dev.fairkom.net/#rt='
```

### Nginx rewrite (required)

Jitsi appends the room name as a path segment (`/myroom1?showControls=true&...`). Tomcat cannot route sub-paths, so the nginx ingress must rewrite these internally to `/` while keeping the browser URL intact. This is already applied in `overlay/dev/patch-ingress.yaml`:

```yaml
nginx.ingress.kubernetes.io/configuration-snippet: |
  if ($args ~* "showControls=true") {
    rewrite ^/\w+$ / break;
  }
```

Apply this annotation to whichever overlay you deploy for Jitsi.

## API Endpoints (realtime-server)

| Endpoint | Method | Description |
|---|---|---|
| `/rt?id=<roomId>` | WebSocket | Real-time relay — clients send/receive `{type:"xml", xml:"..."}` |
| `/cache` | POST | draw.io stores encrypted diagram snapshot: `id=&sid=&msg=` |
| `/cache` | GET | draw.io polls for latest snapshot: `?id=&sid=` |
| `/health` | GET | Liveness/readiness probe |
| `/stats` | GET | JSON: room count, connected clients, uptime |

## Hosting

The above mentioned servers are for demonstration & dev purposes only and may break or timeout (low resource dev cluster).  

Contact sales ät fairkom.eu if you want fairkom host that reliably for your production Nextcloud or Jitsi instance or as a  stand-alone GDRP compliant drawio service with your own domain.

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

AGPLv3 

Professional usage conditions see FAIRPAY.md

## Author

[Roland Alton](https://roland.alton.at) with paid AI support from mistral & claude
