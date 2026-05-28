#!/bin/bash
# Cache management helper script
# Clears cache while preserving critical data

set -e

echo "HexmonSignage Player - Cache Management"
echo "========================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    echo "Usage: sudo hexmon-clear-cache"
    exit 1
fi

CACHE_DIR="/var/cache/hexmon"

if [ ! -d "$CACHE_DIR" ]; then
    echo "Error: Cache directory not found at $CACHE_DIR"
    exit 1
fi

# Show current cache usage
echo "Current cache usage:"
du -sh "$CACHE_DIR"
echo ""

# Ask for confirmation
read -p "Clear cache? This will remove all cached media files. (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

# Stop service if running
SERVICE_WAS_RUNNING=false
if systemctl is-active --quiet hexmon-player; then
    echo "Stopping service..."
    systemctl stop hexmon-player
    SERVICE_WAS_RUNNING=true
    echo "✓ Service stopped"
fi

# Clear cache objects
if [ -d "$CACHE_DIR/objects" ]; then
    echo "Clearing cached objects..."
    rm -rf "$CACHE_DIR/objects"/*
    echo "✓ Cached objects cleared"
fi

# Clear cache index
if [ -f "$CACHE_DIR/cache-index.db" ]; then
    echo "Clearing cache index..."
    rm -f "$CACHE_DIR/cache-index.db"
    echo "✓ Cache index cleared"
fi

# Clear quarantine
if [ -d "$CACHE_DIR/quarantine" ]; then
    echo "Clearing quarantine..."
    rm -rf "$CACHE_DIR/quarantine"/*
    echo "✓ Quarantine cleared"
fi

# Preserve logs and PoP spool
echo "Preserving logs and proof-of-play data..."

# Show new cache usage
echo ""
echo "New cache usage:"
du -sh "$CACHE_DIR"

# Restart service if it was running
if [ "$SERVICE_WAS_RUNNING" = true ]; then
    echo ""
    read -p "Restart service? (Y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        systemctl start hexmon-player
        echo "✓ Service restarted"
    fi
fi

echo ""
echo "Cache cleared successfully!"
echo ""

