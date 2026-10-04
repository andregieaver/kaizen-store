#!/usr/bin/env bash
# Starts the local Postgres cluster if it is down (a restarted sandbox leaves a stale pid file
# and no server) and waits until it accepts connections. Safe to run any time.
#   bash scripts/ensure-postgres.sh
set -u
if pg_isready -q -h localhost -p 5432; then
  exit 0
fi
cluster="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {print $1, $2}')"
if [ -z "$cluster" ]; then
  echo "No Postgres cluster is installed here." >&2
  exit 1
fi
# shellcheck disable=SC2086
pg_ctlcluster $cluster start 2>&1 | tail -2
for _ in $(seq 1 30); do
  if pg_isready -q -h localhost -p 5432; then
    echo "postgres is up"
    exit 0
  fi
  sleep 1
done
echo "postgres did not come up; see /var/log/postgresql" >&2
exit 1
