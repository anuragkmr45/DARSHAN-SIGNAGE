#!/bin/bash
# Post-installation script for DARSHAN Player
# Creates user, directories, and sets up permissions

set -e

echo "DARSHAN Player - Post-installation"
echo "========================================"

# Create darshan user if it doesn't exist
if ! id -u darshan > /dev/null 2>&1; then
    echo "Creating darshan user..."
    useradd -r -s /bin/false -d /var/lib/darshan -m darshan
    echo "✓ User created"
else
    echo "✓ User darshan already exists"
fi

# Create required directories
echo "Creating directories..."
mkdir -p /var/lib/darshan/certs
mkdir -p /var/cache/darshan/objects
mkdir -p /var/cache/darshan/logs
mkdir -p /var/cache/darshan/pop-spool
mkdir -p /etc/darshan
echo "✓ Directories created"

# Set ownership
echo "Setting ownership..."
chown -R darshan:darshan /var/lib/darshan
chown -R darshan:darshan /var/cache/darshan
chown root:darshan /etc/darshan
echo "✓ Ownership set"

# Set permissions
echo "Setting permissions..."
chmod 700 /var/lib/darshan/certs
chmod 755 /var/cache/darshan
chmod 755 /var/cache/darshan/objects
chmod 755 /var/cache/darshan/logs
chmod 755 /var/cache/darshan/pop-spool
chmod 750 /etc/darshan
echo "✓ Permissions set"

# Copy example config if config doesn't exist
if [ ! -f /etc/darshan/config.json ]; then
    if [ -f /usr/share/darshan/config.example.json ]; then
        echo "Creating default configuration..."
        cp /usr/share/darshan/config.example.json /etc/darshan/config.json
        chown root:darshan /etc/darshan/config.json
        chmod 640 /etc/darshan/config.json
        echo "✓ Configuration created at /etc/darshan/config.json"
        echo "  Please edit this file with your settings"
    fi
else
    echo "✓ Configuration already exists"
fi

# Install systemd service
if [ -d /etc/systemd/system ]; then
    echo "Installing systemd service..."
    cp /usr/share/darshan/darshan-player.service /etc/systemd/system/
    systemctl daemon-reload
    echo "✓ Systemd service installed"
    echo ""
    echo "To enable and start the service:"
    echo "  sudo systemctl enable darshan-player"
    echo "  sudo systemctl start darshan-player"
fi

# Add darshan user to video group for display access
if getent group video > /dev/null 2>&1; then
    echo "Adding darshan user to video group..."
    usermod -a -G video darshan
    echo "✓ User added to video group"
fi

# Set up X11 access for darshan user
echo "Setting up X11 access..."
if [ -f /home/darshan/.Xauthority ]; then
    chown darshan:darshan /home/darshan/.Xauthority
fi
echo "✓ X11 access configured"

echo ""
echo "========================================"
echo "Installation completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit configuration: sudo nano /etc/darshan/config.json"
echo "2. Enable service: sudo systemctl enable darshan-player"
echo "3. Start service: sudo systemctl start darshan-player"
echo "4. Check status: sudo systemctl status darshan-player"
echo "5. View logs: sudo journalctl -u darshan-player -f"
echo ""
echo "For pairing, use: darshan-pair-device"
echo "For help, visit: https://docs.darshan.com"
echo ""

