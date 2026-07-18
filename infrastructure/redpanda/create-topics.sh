#!/bin/sh
# Creates the PulseGrid topics with explicit partition/retention settings.
set -e
BROKER="${BROKER:-redpanda:9092}"
create() {
  rpk topic create "$1" --brokers "$BROKER" --partitions "$2" --replicas 1 \
    --topic-config retention.ms="$3" || true
}
create pulsegrid.telemetry.raw       3 7200000     # 2 h — high volume
create pulsegrid.telemetry.processed 3 7200000
create pulsegrid.alerts              1 86400000    # 24 h
create pulsegrid.incidents           1 86400000
create pulsegrid.deadletter          1 86400000
rpk topic list --brokers "$BROKER"
