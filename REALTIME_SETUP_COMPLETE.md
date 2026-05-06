# Real-Time Collaboration — Setup Notes

> For full architecture and engineering history, see [README.md](README.md) and [CHALLENGES.md](CHALLENGES.md).

## Current Implementation

Real-time object sync is working between browser tabs using a custom Node.js WebSocket server. The implementation replaces Pusher.com with a self-hosted relay for GDPR compliance.

**Mechanism in one sentence:** On every model change, the editing tab encodes the full diagram XML with mxGraph's own codec and sends it to the server; the server broadcasts it to all other tabs; receiving tabs apply it directly to their mxGraph model instance.

## Files Changed

| File | What it does |
|---|---|
| `base/configmap.yaml` | Contains `PreConfig.js` — the RT shim injected into draw.io |
| `base/deployment.yaml` | Startup command copies `PreConfig.js` into Tomcat's webapp dir |
| `base/realtime-server-deployment.yaml` | Deploys the Node.js relay server |
| `base/realtime-server-service.yaml` | Exposes the relay server inside the cluster |
| `base/ingress.yaml` | Routes `/rt` (WebSocket) and `/cache` (HTTP) to the relay server |
| `realtime-server/server.js` | The relay server — WebSocket room broadcast + HTTP cache |

## Updating PreConfig.js

Edit the `PreConfig.js:` key inside `base/configmap.yaml`, then:

```bash
kubectl apply -f base/configmap.yaml
kubectl rollout restart deployment/drawio
```

## Updating the Relay Server

Edit `realtime-server/server.js`, then build and push a new image:

```bash
cd realtime-server
docker build -t registry.osalliance.com/drawio/drawio-realtime:vX.X.X .
docker push registry.osalliance.com/drawio/drawio-realtime:vX.X.X
```

Update the image tag in `base/realtime-server-deployment.yaml`, then apply:

```bash
kubectl apply -f base/realtime-server-deployment.yaml
```

## Verifying It Works

Open the same diagram in two browser tabs. Open the developer console in each. You should see:

**Tab that edits (on object move):**
```
[DrawIO RT] Sent XML (NNNN chars)
```

**Tab that receives:**
```
[DrawIO RT] Applied remote XML (NNNN chars)
```

If `Sent XML` appears but the receiving tab shows nothing, check:
1. Both tabs are on the same diagram (same room ID in the server logs).
2. The ingress WebSocket timeout is not too short (`proxy-read-timeout: "3600"`).
3. `kubectl logs deployment/drawio-realtime` for any errors.
