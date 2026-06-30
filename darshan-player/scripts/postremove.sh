#!/bin/bash
# Post-removal script for DARSHAN Player
# Cleans up user, directories, and services

set -e

echo "DARSHAN Player - Post-removal"
echo "===================================="

# Stop and disable service
if systemctl is-active --quiet darshan-player; then
    echo "Stopping service..."
    systemctl stop darshan-player
    echo "✓ Service stopped"
fi

if systemctl is-enabled --quiet darshan-player 2>/dev/null; then
    echo "Disabling service..."
    systemctl disable darshan-player
    echo "✓ Service disabled"
fi

# Remove systemd service file
if [ -f /etc/systemd/system/darshan-player.service ]; then
    echo "Removing systemd service..."
    rm -f /etc/systemd/system/darshan-player.service
    systemctl daemon-reload
    echo "✓ Systemd service removed"
fi

# Ask user if they want to remove data
echo ""
read -p "Remove all data and configuration? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing data and configuration..."
    
    # Remove directories
    rm -rf /var/lib/darshan
    rm -rf /var/cache/darshan
    rm -rf /etc/darshan
    
    echo "✓ Data and configuration removed"
    
    # Remove user
    if id -u darshan > /dev/null 2>&1; then
        echo "Removing darshan user..."
        userdel darshan
        echo "✓ User removed"
    fi
else
    echo "Data and configuration preserved at:"
    echo "  - /var/lib/darshan"
    echo "  - /var/cache/darshan"
    echo "  - /etc/darshan"
fi

echo ""
echo "===================================="
echo "Removal completed"
echo ""

