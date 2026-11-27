"""Пароли и сессии.

Пароль хешируется готовой библиотекой argon2-cffi: в базе лежит только строка вида
$argon2id$v=19$m=65536,t=3,p=4$…, из которой пароль восстановить нельзя.
После входа браузер получает случайный токен в cookie, а в базе хранится
только его хеш SHA-256 — даже по копии базы нельзя войти от чужого имени.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

SESSION_COOKIE = "kopilka_session"
SESSION_DAYS = 7

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


# Хеш-заглушка: проверяется при входе с несуществующей почтой, чтобы ответ
# занимал столько же времени, сколько при неверном пароле
DUMMY_HASH = hash_password("kopilka-dummy-password")


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, user_id: int) -> str:
    """Создаёт сессию и возвращает токен для cookie."""
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (_token_hash(token), user_id, now_iso(), expires.isoformat(timespec="seconds")),
    )
    db.commit()
    return token


def user_by_token(db, token: str | None):
    """Пользователь по токену из cookie или None, если токена нет или сессия истекла."""
    if not token:
        return None
    return db.execute(
        """SELECT users.* FROM sessions
           JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
        (_token_hash(token), now_iso()),
    ).fetchone()


def delete_expired_sessions(db) -> None:
    db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_iso(),))
    db.commit()


def delete_session(db, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        db.commit()
