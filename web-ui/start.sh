#!/bin/sh
set -eu

cron -f -l 2 &
exec node /opt/rewards-web/server.js
