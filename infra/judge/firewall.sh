#!/usr/bin/env bash
# Host firewall for the judge VM (Ubuntu, ufw). Run once as root after provisioning.
#   ADMIN_IP=203.0.113.7 ./firewall.sh
# Note: Docker publishes ports by editing iptables directly and can bypass ufw.
# Only Caddy publishes ports (80/443) in docker-compose.yml, on purpose.
set -euo pipefail

: "${ADMIN_IP:?Set ADMIN_IP to the address you administer the VM from}"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing          # OS updates, image pulls, ACME. Sandboxes have no network (isolate + internal Docker network).
ufw allow from "$ADMIN_IP" to any port 22 proto tcp
ufw allow 80/tcp                    # ACME HTTP-01 challenge + redirect to HTTPS
ufw allow 443/tcp
ufw --force enable
ufw status verbose
