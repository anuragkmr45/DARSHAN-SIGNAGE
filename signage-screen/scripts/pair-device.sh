#!/bin/bash
# Device pairing helper script
# Assists with pairing a device to the HexmonSignage backend

set -e

echo "HexmonSignage Player - Device Pairing"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run as root"
    echo "Usage: sudo hexmon-pair-device"
    exit 1
fi

# Check if service is running
if systemctl is-active --quiet hexmon-player; then
    echo "Note: The player service is currently running."
    read -p "Stop the service to pair? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        systemctl stop hexmon-player
        echo "✓ Service stopped"
    else
        echo "Pairing can be done through the UI when the service starts."
        exit 0
    fi
fi

# Check configuration
CONFIG_FILE="/etc/hexmon/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file not found at $CONFIG_FILE"
    echo "Please run: sudo cp /usr/share/hexmon/config.example.json $CONFIG_FILE"
    exit 1
fi

echo "Configuration file: $CONFIG_FILE"
echo ""

# Get API base URL from config
API_BASE=$(grep -o '"apiBase"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | cut -d'"' -f4)
if [ -z "$API_BASE" ]; then
    echo "Error: Could not read apiBase from configuration"
    exit 1
fi

echo "API Base URL: $API_BASE"
echo ""

# Prompt for pairing code
read -p "Enter 6-character pairing code: " PAIRING_CODE

# Validate pairing code format
if ! [[ "$PAIRING_CODE" =~ ^[A-Z0-9]{6}$ ]]; then
    echo "Error: Invalid pairing code format. Must be 6 alphanumeric characters."
    exit 1
fi

echo ""
echo "Pairing device..."
echo "Code: $PAIRING_CODE"
echo ""

# Generate CSR (simplified - in production, use the app's certificate manager)
CERT_DIR="/var/lib/hexmon/certs"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [ ! -f "$CERT_DIR/client.key" ]; then
    echo "Generating key pair..."
    openssl ecparam -name prime256v1 -genkey -noout -out "$CERT_DIR/client.key"
    chmod 600 "$CERT_DIR/client.key"
    echo "✓ Key pair generated"
fi

echo "Generating CSR..."
openssl req -new -key "$CERT_DIR/client.key" -out "$CERT_DIR/client.csr" \
    -subj "/CN=$(hostname)/O=HexmonSignage/C=US"
echo "✓ CSR generated"

# Read CSR
CSR=$(cat "$CERT_DIR/client.csr" | sed ':a;N;$!ba;s/\n/\\n/g')

# Get device info
HOSTNAME=$(hostname)
PLATFORM=$(uname -s)
ARCH=$(uname -m)

# Prepare JSON payload
JSON_PAYLOAD=$(cat <<EOF
{
  "pairing_code": "$PAIRING_CODE",
  "csr": "$CSR",
  "device_info": {
    "hostname": "$HOSTNAME",
    "platform": "$PLATFORM",
    "arch": "$ARCH"
  }
}
EOF
)

# Submit pairing request
echo "Submitting pairing request..."
RESPONSE=$(curl -s -X POST "$API_BASE/v1/device-pairing/complete" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD")

# Check response
if echo "$RESPONSE" | grep -q "device_id"; then
    DEVICE_ID=$(echo "$RESPONSE" | grep -o '"device_id"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    
    echo "✓ Pairing successful!"
    echo ""
    echo "Device ID: $DEVICE_ID"
    
    # Save certificate
    echo "$RESPONSE" | grep -o '"certificate"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 | sed 's/\\n/\n/g' > "$CERT_DIR/client.crt"
    echo "$RESPONSE" | grep -o '"ca_certificate"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 | sed 's/\\n/\n/g' > "$CERT_DIR/ca.crt"
    
    chmod 600 "$CERT_DIR/client.crt"
    chmod 600 "$CERT_DIR/ca.crt"
    chown -R hexmon:hexmon "$CERT_DIR"
    
    echo "✓ Certificates saved"
    
    # Update config with device ID
    sed -i "s/\"deviceId\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"deviceId\": \"$DEVICE_ID\"/" "$CONFIG_FILE"
    echo "✓ Configuration updated"
    
    echo ""
    echo "Pairing complete! You can now start the service:"
    echo "  sudo systemctl start hexmon-player"
    
else
    echo "✗ Pairing failed"
    echo "Response: $RESPONSE"
    exit 1
fi

echo ""

