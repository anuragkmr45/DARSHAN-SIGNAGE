#!/bin/bash
# Log collection helper script
# Collects logs for troubleshooting

set -e

echo "HexmonSignage Player - Log Collection"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    echo "Usage: sudo hexmon-collect-logs"
    exit 1
fi

# Create temporary directory for logs
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="/tmp/hexmon-logs-$TIMESTAMP"
mkdir -p "$LOG_DIR"

echo "Collecting logs to: $LOG_DIR"
echo ""

# Collect application logs
if [ -d "/var/cache/hexmon/logs" ]; then
    echo "Collecting application logs..."
    cp -r /var/cache/hexmon/logs "$LOG_DIR/app-logs"
    echo "✓ Application logs collected"
fi

# Collect systemd journal
echo "Collecting systemd journal..."
journalctl -u hexmon-player --no-pager > "$LOG_DIR/systemd-journal.log" 2>&1 || true
echo "✓ Systemd journal collected"

# Collect system information
echo "Collecting system information..."
{
    echo "=== System Information ==="
    uname -a
    echo ""
    echo "=== Distribution ==="
    cat /etc/os-release 2>/dev/null || echo "Not available"
    echo ""
    echo "=== Memory ==="
    free -h
    echo ""
    echo "=== Disk Usage ==="
    df -h
    echo ""
    echo "=== CPU Info ==="
    lscpu | head -20
    echo ""
    echo "=== Network Interfaces ==="
    ip addr
    echo ""
    echo "=== Display ==="
    echo "DISPLAY=$DISPLAY"
    xrandr 2>/dev/null || echo "xrandr not available"
} > "$LOG_DIR/system-info.txt"
echo "✓ System information collected"

# Collect configuration (redact sensitive data)
if [ -f "/etc/hexmon/config.json" ]; then
    echo "Collecting configuration..."
    # Redact sensitive fields
    cat /etc/hexmon/config.json | \
        sed 's/"deviceId"[[:space:]]*:[[:space:]]*"[^"]*"/"deviceId": "REDACTED"/' | \
        sed 's/"apiBase"[[:space:]]*:[[:space:]]*"[^"]*"/"apiBase": "REDACTED"/' \
        > "$LOG_DIR/config.json"
    echo "✓ Configuration collected (sensitive data redacted)"
fi

# Collect service status
echo "Collecting service status..."
{
    echo "=== Service Status ==="
    systemctl status hexmon-player --no-pager || true
    echo ""
    echo "=== Service Properties ==="
    systemctl show hexmon-player --no-pager || true
} > "$LOG_DIR/service-status.txt"
echo "✓ Service status collected"

# Collect cache statistics
if [ -d "/var/cache/hexmon" ]; then
    echo "Collecting cache statistics..."
    {
        echo "=== Cache Directory Size ==="
        du -sh /var/cache/hexmon
        echo ""
        echo "=== Cache Breakdown ==="
        du -sh /var/cache/hexmon/* 2>/dev/null || echo "No cache data"
        echo ""
        echo "=== Cache File Count ==="
        find /var/cache/hexmon -type f | wc -l
    } > "$LOG_DIR/cache-stats.txt"
    echo "✓ Cache statistics collected"
fi

# Collect certificate information (not the actual certificates)
if [ -d "/var/lib/hexmon/certs" ]; then
    echo "Collecting certificate information..."
    {
        echo "=== Certificate Files ==="
        ls -lh /var/lib/hexmon/certs/ 2>/dev/null || echo "No certificates"
        echo ""
        if [ -f "/var/lib/hexmon/certs/client.crt" ]; then
            echo "=== Client Certificate Info ==="
            openssl x509 -in /var/lib/hexmon/certs/client.crt -noout -text 2>/dev/null || echo "Cannot read certificate"
        fi
    } > "$LOG_DIR/cert-info.txt"
    echo "✓ Certificate information collected"
fi

# Create tarball
TARBALL="/tmp/hexmon-logs-$TIMESTAMP.tar.gz"
echo ""
echo "Creating tarball..."
tar -czf "$TARBALL" -C /tmp "hexmon-logs-$TIMESTAMP"
rm -rf "$LOG_DIR"

echo "✓ Tarball created: $TARBALL"
echo ""
echo "======================================"
echo "Log collection complete!"
echo ""
echo "Tarball location: $TARBALL"
echo "Size: $(du -h "$TARBALL" | cut -f1)"
echo ""
echo "Please send this file to support for analysis."
echo ""

