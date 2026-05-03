# draw.io Server for k8s

A self-hosted diagram and flowchart editor based on draw.io for deployment with kustomize.

## Overview

This is a server deployment of draw.io, allowing you to run a fully functional diagramming application on your own infrastructure.

## Features

- Create and edit diagrams online
- Support for flowcharts, UML, entity relationships, and more
- **Real-time collaborative editing** with local Yjs-based server
- Collaborative editing capabilities
- Export to multiple formats (PNG, SVG, PDF, etc.)
- Self-hosted and privacy-focused

## Installation

1. Clone or download the draw.io repository
2. Build the real-time server image:
   ```bash
   cd realtime-server
   docker build -t drawio-realtime:latest .
   cd ..
   ```
3. Create namespace at your kubernetes cluster
4. Assign domain and adapt in ingress.yaml
5. cd overlay/dev
6. kubectl apply -k .


## Usage

Access the application through your web browser once the server is running.

### Real-Time Collaboration

The deployment includes a local Node.js real-time server powered by Yjs for conflict-free collaborative editing. This eliminates the dependency on Cloudflare's infrastructure.

**Key features:**
- Multiple users can edit the same diagram simultaneously
- Changes are synchronized in real-time across all clients
- Automatic presence tracking (see who's editing)
- No external service dependencies

See [realtime-server/README.md](realtime-server/README.md) for detailed real-time server documentation.

### Nextcloud

Install the draw.io app and replace the default server https://embed.diagrams.net with your domain e.g. https://drawio-dev.fairkom.net

## Documentation

For detailed information, visit the [official draw.io documentation](https://www.diagrams.net).

## License

Apache 2.0

## Author

Roland Alton
