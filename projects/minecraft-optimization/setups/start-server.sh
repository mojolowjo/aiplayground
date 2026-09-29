#!/bin/sh
# Starts a Minecraft 26.3 Fabric server with the flags recommended in README.md.
# Put this next to fabric-server-launch.jar. Needs Java 25.
#
#   MEMORY=6G ./start-server.sh         # give the server 6 GB
#   COLLECTOR=zgc ./start-server.sh     # no GC stutters; best with 6+ CPU cores

MEMORY="${MEMORY:-4G}"
COLLECTOR="${COLLECTOR:-g1}"

case "$COLLECTOR" in
	g1) GC_FLAGS="-XX:+UseCompactObjectHeaders" ;;
	zgc) GC_FLAGS="-XX:+UseZGC" ;;
	*) echo "COLLECTOR must be g1 or zgc" >&2; exit 1 ;;
esac

exec java "-Xms$MEMORY" "-Xmx$MEMORY" $GC_FLAGS -jar fabric-server-launch.jar nogui
