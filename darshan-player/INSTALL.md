# Installation Instructions

> Note: the current supported production model is a Windows or Ubuntu desktop-session install. This document still contains the older Ubuntu/systemd workflow for legacy environments. For the current support matrix and runtime defaults, start with [README.md](./README.md) and [PLATFORM_SUPPORT.md](./PLATFORM_SUPPORT.md).

## Prerequisites

### System Requirements
- **OS**: Ubuntu 20.04 LTS or later
- **CPU**: 2+ cores recommended
- **RAM**: 2GB minimum, 4GB recommended
- **Disk**: 10GB+ free space for cache
- **Display**: 1920x1080 or higher recommended

### Software Requirements
- Node.js 20 LTS and npm 9+
- Git (for development)

## Quick Install (From Package)

### 1. Download Package

Download the latest .deb package from releases:
```bash
wget https://github.com/darshan/signage-player/releases/latest/download/darshan-player_1.0.0_amd64.deb
```

### 2. Install Package

```bash
sudo dpkg -i darshan-player_1.0.0_amd64.deb
```

If there are dependency issues:
```bash
sudo apt-get install -f
```

### 3. Configure

Create configuration file:
```bash
sudo mkdir -p /etc/darshan
sudo cp /usr/share/darshan/config.example.json /etc/darshan/config.json
sudo nano /etc/darshan/config.json
```

Edit the configuration:
```json
{
  "apiBase": "https://your-api-server.com",
  "wsUrl": "wss://your-api-server.com/ws",
  "deviceId": ""
}
```

### 4. Enable and Start Service

```bash
sudo systemctl enable darshan-player
sudo systemctl start darshan-player
```

### 5. Check Status

```bash
sudo systemctl status darshan-player
```

### 6. Pair Device

The pairing screen will appear on first run. Enter the 6-character code from your admin dashboard.

## Development Install (From Source)

### 1. Install Node.js

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be 18.x or higher
npm --version   # Should be 9.x or higher
```

### 2. Clone Repository

```bash
git clone https://github.com/darshan/signage-player.git
cd signage-player
```

### 3. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- Electron
- TypeScript
- Pino (logging)
- Better SQLite3 (cache index)
- MinIO SDK
- Axios (HTTP client)
- WebSocket client
- And more...

### 4. Configure

```bash
cp config.example.json config.json
nano config.json
```

### 5. Build

```bash
npm run build
```

### 6. Run in Development Mode

```bash
npm run start:dev
```

### 7. Package (Optional)

To create distributable packages:

```bash
# .deb package
npm run package:deb

# AppImage
npm run package:appimage

# Both
npm run package
```

Packages will be created in the `build/` directory.

## Post-Installation

### Create darshan User (Production)

For production deployments, create a dedicated user:

```bash
sudo useradd -r -s /bin/false darshan
sudo mkdir -p /var/lib/darshan/certs
sudo mkdir -p /var/cache/darshan
sudo chown -R darshan:darshan /var/lib/darshan
sudo chown -R darshan:darshan /var/cache/darshan
sudo chmod 700 /var/lib/darshan/certs
```

### Configure Autostart

The systemd service should handle autostart, but you can also configure it via desktop environment:

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/darshan-player.desktop << EOF
[Desktop Entry]
Type=Application
Name=DARSHAN Player
Exec=/usr/bin/darshan-player
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF
```

### Configure Display

For kiosk mode, you may want to disable screen blanking:

```bash
# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Make permanent by adding to ~/.xinitrc or ~/.xsession
echo "xset s off" >> ~/.xinitrc
echo "xset -dpms" >> ~/.xinitrc
echo "xset s noblank" >> ~/.xinitrc
```

### Configure Network

Ensure the device has network connectivity:

```bash
# Test connectivity to API server
ping -c 3 your-api-server.com

# Test HTTPS connectivity
curl -I https://your-api-server.com

# Test WebSocket connectivity (if applicable)
curl -I https://your-api-server.com/ws
```

## Verification

### Check Service Status

```bash
sudo systemctl status darshan-player
```

Expected output:
```
● darshan-player.service - DARSHAN Player
     Loaded: loaded (/etc/systemd/system/darshan-player.service; enabled)
     Active: active (running) since ...
```

### Check Health Endpoint

```bash
curl http://127.0.0.1:3300/healthz
```

`/metrics` is available on the same listener when `observability.metricsEnabled=true`. The default install keeps that listener on `127.0.0.1:3300`.

Expected output:
```json
{
  "status": "healthy",
  "appVersion": "1.0.0",
  "uptime": 3600,
  ...
}
```

### Check Logs

```bash
# Systemd logs
sudo journalctl -u darshan-player -f

# Application logs
sudo tail -f /var/cache/darshan/logs/darshan-*.log
```

## Troubleshooting

### Service Won't Start

Check logs:
```bash
sudo journalctl -u darshan-player -n 50
```

Common issues:
- Missing configuration file
- Invalid configuration
- Permission issues
- Display not available

### Display Issues

Ensure DISPLAY environment variable is set:
```bash
export DISPLAY=:0
```

Check X authority:
```bash
export XAUTHORITY=/home/darshan/.Xauthority
```

### Permission Issues

Fix permissions:
```bash
sudo chown -R darshan:darshan /var/lib/darshan
sudo chown -R darshan:darshan /var/cache/darshan
sudo chmod 700 /var/lib/darshan/certs
sudo chmod 600 /var/lib/darshan/certs/*
```

### Network Issues

Test connectivity:
```bash
# Test DNS resolution
nslookup your-api-server.com

# Test HTTPS
curl -v https://your-api-server.com

# Test with mTLS (if configured)
curl --cert /var/lib/darshan/certs/client.crt \
     --key /var/lib/darshan/certs/client.key \
     --cacert /var/lib/darshan/certs/ca.crt \
     https://your-api-server.com
```

## Uninstallation

### Remove Package

```bash
sudo dpkg -r darshan-player
```

### Remove Configuration and Data

```bash
sudo rm -rf /etc/darshan
sudo rm -rf /var/lib/darshan
sudo rm -rf /var/cache/darshan
```

### Remove User

```bash
sudo userdel darshan
```

## Upgrading

### From Package

```bash
# Download new version
wget https://github.com/darshan/signage-player/releases/latest/download/darshan-player_1.1.0_amd64.deb

# Stop service
sudo systemctl stop darshan-player

# Install new version
sudo dpkg -i darshan-player_1.1.0_amd64.deb

# Start service
sudo systemctl start darshan-player
```

### From Source

```bash
# Pull latest changes
git pull

# Install dependencies
npm install

# Build
npm run build

# Restart service
sudo systemctl restart darshan-player
```

## Support

For additional help:
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Check [README.md](./README.md)
- Check logs in `/var/cache/darshan/logs/`
- Contact support@darshan.com

## Next Steps

After installation:
1. Pair the device using the pairing screen
2. Verify connectivity with health check
3. Monitor logs for any issues
4. Configure schedules in admin dashboard
5. Test playback with sample content

## Security Notes

- Always use HTTPS for API communication
- Enable mTLS for production deployments
- Keep certificates secure (0600 permissions)
- Regularly update the application
- Monitor logs for security events
- Use firewall rules to restrict access

## Performance Tuning

For optimal performance:
- Allocate sufficient disk space for cache (10GB+)
- Use SSD for cache storage if possible
- Ensure stable network connectivity
- Monitor system resources
- Adjust cache size based on content needs
- Use appropriate bandwidth budget settings
