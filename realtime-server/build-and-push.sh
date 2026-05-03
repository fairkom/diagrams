#!/bin/bash

# Draw.io Real-Time Server - Image Build & Push Script
# 
# This script builds the Docker image for the real-time server
# and pushes it to a registry so it's available for Kubernetes deployment

set -e

REGISTRY_URL="${1:-docker.io}"
REGISTRY_USER="${2:-}"
IMAGE_NAME="drawio-realtime"
IMAGE_TAG="${3:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Draw.io Real-Time Server - Build & Push${NC}"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Build the image
echo -e "${YELLOW}Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}${NC}"
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build successful${NC}"
echo ""

# Push to registry if registry URL is provided
if [ ! -z "$REGISTRY_URL" ] && [ "$REGISTRY_URL" != "local" ]; then
    FULL_IMAGE_NAME="${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
    
    echo -e "${YELLOW}Pushing to registry: ${FULL_IMAGE_NAME}${NC}"
    
    # Tag for registry
    docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${FULL_IMAGE_NAME}
    
    # Login if credentials provided
    if [ ! -z "$REGISTRY_USER" ]; then
        echo -e "${YELLOW}Logging into registry...${NC}"
        docker login ${REGISTRY_URL} -u ${REGISTRY_USER}
    fi
    
    # Push
    docker push ${FULL_IMAGE_NAME}
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Push successful${NC}"
        echo ""
        echo -e "${YELLOW}Update your kustomization with:${NC}"
        echo "images:"
        echo "  - name: drawio-realtime"
        echo "    newName: ${FULL_IMAGE_NAME}"
    else
        echo -e "${RED}Push failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}No registry URL provided or 'local' specified${NC}"
    echo -e "${YELLOW}Using locally built image (IfNotPresent policy)${NC}"
    echo ""
    echo -e "${GREEN}Image is ready for local use:${NC}"
    echo "  docker images | grep ${IMAGE_NAME}"
fi

echo ""
echo -e "${GREEN}Done!${NC}"
