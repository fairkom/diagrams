# Real-Time Collaboration Setup Complete!

Your draw.io deployment now has a self-hosted real-time collaboration server. Here's what was created:

## What's Included

### 1. **Node.js Real-Time Server** (`realtime-server/`)
- **Framework**: Yjs (modern CRDT library) + WebSocket
- **Language**: JavaScript (Node.js 18)
- **Port**: 8081
- **Features**:
  - Conflict-free synchronization
  - User presence tracking
  - Automatic room cleanup
  - Health check endpoints
  - Stats monitoring

### 2. **Kubernetes Manifests**
- `base/realtime-server-deployment.yaml` - Server deployment
- `base/realtime-server-service.yaml` - Internal service
- `overlay/dev/realtime-ingress.yaml` - Route /realtime to server

### 3. **Client Integration**
- `overlay/dev/patch-configmap.yaml` - Injects real-time config into draw.io
- Automatic server URL detection based on domain

### 4. **Docker Image**
- `realtime-server/Dockerfile` - Production-ready image
- `realtime-server/build-and-push.sh` - Build and deployment script

## Next Steps: Deploy the Image

### Current Status
The real-time server pod is pending image availability. Choose your deployment method:

#### **Option A: Push to Docker Hub (Recommended)**
```bash
cd realtime-server
docker login
./build-and-push.sh docker.io your-username
```

Then update `base/kustomization.yaml`:
```yaml
images:
  - name: drawio-realtime
    newName: docker.io/your-username/drawio-realtime:latest
```

#### **Option B: Push to Private Registry**
```bash
./build-and-push.sh your-private-registry.com/yourproject
```

Update `base/kustomization.yaml`:
```yaml
images:
  - name: drawio-realtime
    newName: your-private-registry.com/yourproject/drawio-realtime:latest
```

#### **Option C: Production Overlay**
Use the included production overlay for easier registry configuration:
```bash
cd overlay/prod
# Edit kustomization.yaml with your registry
# Edit patch-ingress.yaml with your domain
kubectl apply -k .
```

### Verify Deployment
```bash
# Check pod status
kubectl get pods -n drawio-dev | grep realtime

# Check logs
kubectl logs -f deployment/drawio-realtime -n drawio-dev

# Check stats
kubectl exec deployment/drawio-realtime -n drawio-dev -- curl localhost:8081/stats
```

## Architecture

```
User A (Browser)     User B (Browser)
     ↓                    ↓
    WSS Protocol         WSS Protocol
     ↓                    ↓
Nginx Ingress (/realtime)
     ↓
drawio-realtime Service (port 8081)
     ↓
Node.js WebSocket Server (Yjs)
     ↓
Real-time Document Store (Memory)
```

## How It Works

1. **Connection**: User opens draw.io → client connects to `/realtime` endpoint
2. **Sync**: Initial document state sent via Yjs encoding
3. **Collaboration**: Changes from one user encoded and sent to others
4. **Awareness**: User presence/cursors synced via awareness protocol
5. **Persistence**: Currently in-memory (suitable for production with persistence layer)

## Configuration

### Real-Time Server Environment Variables
- `PORT` (default: 8081) - Server port
- Auto-cleanup inactive rooms after 5 minutes
- WebSocket timeouts: 3600 seconds (1 hour)

### Draw.io Client Config
- Auto-detects server URL from domain
- Enables collaboration when server is available
- Falls back gracefully if server unavailable

## File Structure

```
drawio/
├── realtime-server/               # Real-time server code
│   ├── server.js                  # WebSocket server
│   ├── package.json               # Dependencies
│   ├── Dockerfile                 # Container image
│   ├── build-and-push.sh          # Deploy script
│   └── README.md                  # Server documentation
├── base/
│   ├── realtime-server-deployment.yaml
│   ├── realtime-server-service.yaml
│   └── ...
├── overlay/
│   ├── dev/                       # Development config
│   │   ├── realtime-ingress.yaml
│   │   └── patch-configmap.yaml
│   └── prod/                      # Production config (new)
│       ├── realtime-ingress.yaml
│       ├── patch-ingress.yaml
│       └── kustomization.yaml
└── IMAGE_DEPLOYMENT.md            # Detailed setup guide
```

## Testing Collaboration

Once deployed and running:

1. Open https://drawio-dev.fairkom.net in Browser A
2. Open same URL in Browser B
3. Edit diagram in A → changes should appear in B in real-time
4. Check browser console for "[DrawIO-RT]" debug messages

## Troubleshooting

### Pod stuck in Pending/ErrImageNeverPull
- Image not available in cluster
- Solution: Push to registry following Option A or B above

### WebSocket connection fails
- Check Ingress routes /realtime to service
- Check firewall allows port 8081
- Verify SSL certificates for wss:// connection

### No real-time sync
- Check browser console for errors
- Verify server pod is running and healthy
- Check server logs: `kubectl logs deployment/drawio-realtime -n drawio-dev`

## Security Notes

- Real-time server currently stores documents in memory
- No authentication/authorization on WebSocket endpoint
- For production: implement access control and persistent storage
- Consider adding rate limiting and DDoS protection

## Next: Production Deployment

For production use, consider:
1. **Persistence**: Add database backend (PostgreSQL, MongoDB, etc.)
2. **Scaling**: Use persistent store instead of in-memory
3. **Authentication**: Implement user/document authorization
4. **Monitoring**: Add Prometheus metrics and alerting
5. **Backup**: Regular backups of collaboration data

See `realtime-server/README.md` for detailed documentation.
