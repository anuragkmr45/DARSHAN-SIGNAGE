#!/bin/bash
# Post-removal script for HexmonSignage Player
# Cleans up user, directories, and services

set -e

echo "HexmonSignage Player - Post-removal"
echo "===================================="

# Stop and disable service
if systemctl is-active --quiet hexmon-player; then
    echo "Stopping service..."
    systemctl stop hexmon-player
    echo "✓ Service stopped"
fi

if systemctl is-enabled --quiet hexmon-player 2>/dev/null; then
    echo "Disabling service..."
    systemctl disable hexmon-player
    echo "✓ Service disabled"
fi

# Remove systemd service file
if [ -f /etc/systemd/system/hexmon-player.service ]; then
    echo "Removing systemd service..."
    rm -f /etc/systemd/system/hexmon-player.service
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
    rm -rf /var/lib/hexmon
    rm -rf /var/cache/hexmon
    rm -rf /etc/hexmon
    
    echo "✓ Data and configuration removed"
    
    # Remove user
    if id -u hexmon > /dev/null 2>&1; then
        echo "Removing hexmon user..."
        userdel hexmon
        echo "✓ User removed"
    fi
else
    echo "Data and configuration preserved at:"
    echo "  - /var/lib/hexmon"
    echo "  - /var/cache/hexmon"
    echo "  - /etc/hexmon"
fi

echo ""
echo "===================================="
echo "Removal completed"
echo ""

