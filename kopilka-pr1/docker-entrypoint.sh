#!/bin/sh
set -eu

# Railway монтирует диск с владельцем root. Подготовка тома выполняется до смены пользователя.
if [ "$(id -u)" -eq 0 ]; then
    chown kopilka:kopilka /app/data
    exec setpriv --reuid=kopilka --regid=kopilka --clear-groups --no-new-privs "$0"
fi

exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
