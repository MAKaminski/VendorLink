#!/usr/bin/env bash
#
# Local Postgres harness.
#
# This container has the Postgres 16 server binaries but no running daemon and
# no reachable hosted Postgres (raw :5432 is blocked by the egress proxy), so
# dev and every test run against a cluster we start ourselves under .pgdata/.
#
# Postgres refuses to run as root. When this script is invoked as root (the
# default in the build container) the server-side commands are re-executed as
# an unprivileged user; client connections still go over TCP as `postgres`,
# which the cluster's trust auth accepts regardless of the calling OS user.
#
# Usage: scripts/dev-db.sh {start|stop|status|reset|psql|url}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT/.pgdata}"
PGPORT="${PGPORT:-55432}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DBNAME="${DBNAME:-vendorlink}"
LOGFILE="$PGDATA/server.log"

if [[ ! -x "$PGBIN/pg_ctl" ]]; then
  echo "error: Postgres binaries not found at $PGBIN" >&2
  echo "       set PGBIN to the directory containing pg_ctl/initdb" >&2
  exit 1
fi

# Pick the OS user that will own the server process.
if [[ "$(id -u)" -eq 0 ]]; then
  for candidate in postgres ubuntu nobody; do
    if getent passwd "$candidate" >/dev/null; then
      RUN_AS="$candidate"
      break
    fi
  done
  if [[ -z "${RUN_AS:-}" ]]; then
    echo "error: running as root and no unprivileged user available to own the cluster" >&2
    exit 1
  fi
else
  RUN_AS=""
fi

# Run a server-side command as the owning user (or directly, if not root).
as_pg() {
  if [[ -n "$RUN_AS" ]]; then
    su "$RUN_AS" -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

is_running() {
  as_pg "'$PGBIN/pg_ctl' -D '$PGDATA' status" >/dev/null 2>&1
}

psql_c() {
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres "$@"
}

do_start() {
  if [[ ! -d "$PGDATA/base" ]]; then
    echo "initdb -> $PGDATA"
    mkdir -p "$PGDATA"
    [[ -n "$RUN_AS" ]] && chown -R "$RUN_AS" "$PGDATA"
    # Trust auth on a loopback-only cluster: a throwaway dev database that
    # never holds real credentials and is not reachable off-host.
    as_pg "'$PGBIN/initdb' -D '$PGDATA' -U postgres --auth=trust --encoding=UTF8" >/dev/null
    {
      echo "listen_addresses = '127.0.0.1'"
      echo "port = $PGPORT"
      echo "unix_socket_directories = '$PGDATA'"
      # Durability traded for speed: this cluster is disposable.
      echo "fsync = off"
      echo "synchronous_commit = off"
      echo "full_page_writes = off"
    } >>"$PGDATA/postgresql.conf"
  fi

  # The owning user must be able to traverse the repo path to reach PGDATA.
  if [[ -n "$RUN_AS" ]]; then
    chown -R "$RUN_AS" "$PGDATA"
    chmod o+x "$ROOT" 2>/dev/null || true
  fi

  if is_running; then
    echo "postgres already running on :$PGPORT"
  else
    as_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$LOGFILE' -w start" >/dev/null
    echo "postgres started on :$PGPORT"
  fi

  if ! psql_c -lqt | cut -d'|' -f1 | grep -qw "$DBNAME"; then
    "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U postgres "$DBNAME"
    echo "created database $DBNAME"
  fi

  echo "DATABASE_URL=postgres://postgres@127.0.0.1:$PGPORT/$DBNAME"
}

do_stop() {
  if is_running; then
    as_pg "'$PGBIN/pg_ctl' -D '$PGDATA' -w -m fast stop" >/dev/null
    echo "postgres stopped"
  else
    echo "postgres not running"
  fi
}

case "${1:-start}" in
  start) do_start ;;
  stop) do_stop ;;
  status) is_running && echo "running on :$PGPORT" || { echo "not running"; exit 1; } ;;
  reset)
    do_stop || true
    rm -rf "$PGDATA"
    do_start
    ;;
  psql) exec psql_c ;;
  url) echo "postgres://postgres@127.0.0.1:$PGPORT/$DBNAME" ;;
  *)
    echo "usage: $0 {start|stop|status|reset|psql|url}" >&2
    exit 1
    ;;
esac
