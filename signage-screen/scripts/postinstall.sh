#!/bin/bash
# Post-installation script for HexmonSignage Player
# Creates user, directories, and sets up permissions

set -e

echo "HexmonSignage Player - Post-installation"
echo "========================================"

# Create hexmon user if it doesn't exist
if ! id -u hexmon > /dev/null 2>&1; then
    echo "Creating hexmon user..."
    useradd -r -s /bin/false -d /var/lib/hexmon -m hexmon
    echo "✓ User created"
else
    echo "✓ User hexmon already exists"
fi

# Create required directories
echo "Creating directories..."
mkdir -p /var/lib/hexmon/certs
mkdir -p /var/cache/hexmon/objects
mkdir -p /var/cache/hexmon/logs
mkdir -p /var/cache/hexmon/pop-spool
mkdir -p /etc/hexmon
echo "✓ Directories created"

# Set ownership
echo "Setting ownership..."
chown -R hexmon:hexmon /var/lib/hexmon
chown -R hexmon:hexmon /var/cache/hexmon
chown root:hexmon /etc/hexmon
echo "✓ Ownership set"

# Set permissions
echo "Setting permissions..."
chmod 700 /var/lib/hexmon/certs
chmod 755 /var/cache/hexmon
chmod 755 /var/cache/hexmon/objects
chmod 755 /var/cache/hexmon/logs
chmod 755 /var/cache/hexmon/pop-spool
chmod 750 /etc/hexmon
echo "✓ Permissions set"

# Copy example config if config doesn't exist
if [ ! -f /etc/hexmon/config.json ]; then
    if [ -f /usr/share/hexmon/config.example.json ]; then
        echo "Creating default configuration..."
        cp /usr/share/hexmon/config.example.json /etc/hexmon/config.json
        chown root:hexmon /etc/hexmon/config.json
        chmod 640 /etc/hexmon/config.json
        echo "✓ Configuration created at /etc/hexmon/config.json"
        echo "  Please edit this file with your settings"
    fi
else
    echo "✓ Configuration already exists"
fi

# Install systemd service
if [ -d /etc/systemd/system ]; then
    echo "Installing systemd service..."
    cp /usr/share/hexmon/hexmon-player.service /etc/systemd/system/
    systemctl daemon-reload
    echo "✓ Systemd service installed"
    echo ""
    echo "To enable and start the service:"
    echo "  sudo systemctl enable hexmon-player"
    echo "  sudo systemctl start hexmon-player"
fi

# Add hexmon user to video group for display access
if getent group video > /dev/null 2>&1; then
    echo "Adding hexmon user to video group..."
    usermod -a -G video hexmon
    echo "✓ User added to video group"
fi

# Set up X11 access for hexmon user
echo "Setting up X11 access..."
if [ -f /home/hexmon/.Xauthority ]; then
    chown hexmon:hexmon /home/hexmon/.Xauthority
fi
echo "✓ X11 access configured"

echo ""
echo "========================================"
echo "Installation completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit configuration: sudo nano /etc/hexmon/config.json"
echo "2. Enable service: sudo systemctl enable hexmon-player"
echo "3. Start service: sudo systemctl start hexmon-player"
echo "4. Check status: sudo systemctl status hexmon-player"
echo "5. View logs: sudo journalctl -u hexmon-player -f"
echo ""
echo "For pairing, use: hexmon-pair-device"
echo "For help, visit: https://docs.hexmon.com"
echo ""

