# Image Deployment Options

The real-time server Docker image needs to be available in your Kubernetes cluster. Here are your options:

## Option 1: Push to Docker Hub (Recommended for Production)

```bash
cd realtime-server

# Build and push (requires Docker Hub account)
./build-and-push.sh docker.io your-username

# Then update base/kustomization.yaml:
# images:
#   - name: drawio-realtime
#     newName: docker.io/your-username/drawio-realtime:latest
```

## Option 2: Push to Private Registry

```bash
cd realtime-server

# Build and push to private registry
./build-and-push.sh your-registry.com/yourproject

# Then update base/kustomization.yaml:
# images:
#   - name: drawio-realtime
#     newName: your-registry.com/yourproject/drawio-realtime:latest
```

## Option 3: Use Local Registry (if available on cluster)

```bash
# Build locally
cd realtime-server
docker build -t drawio-realtime:latest .

# Push to local registry endpoint
docker tag drawio-realtime:latest localhost:5000/drawio-realtime:latest
docker push localhost:5000/drawio-realtime:latest

# Update base/realtime-server-deployment.yaml:
# image: localhost:5000/drawio-realtime:latest
```

## Option 4: Manual Node Image Loading (Kind/Minikube)

If using Kind or Minikube locally:

```bash
# For Kind
kind load docker-image drawio-realtime:latest

# For Minikube  
minikube image load drawio-realtime:latest
```

## Current Setup

The deployment currently uses `imagePullPolicy: IfNotPresent`, which means:
- If the image exists in the cluster, it will use it
- Otherwise, it will try to pull from the registry

## Quick Start for Development

For a quick development setup, push to Docker Hub:

```bash
cd realtime-server

# Login to Docker Hub
docker login

# Build and push
./build-and-push.sh docker.io your-username

# Apply kustomization
cd ../overlay/dev
kubectl apply -k .
```

Once deployed, verify with:

```bash
kubectl get pods -n drawio-dev | grep realtime
kubectl logs -f deployment/drawio-realtime -n drawio-dev
```
