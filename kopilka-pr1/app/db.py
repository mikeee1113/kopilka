"""База данных SQLite: подключение и структура таблиц.

Все запросы в проекте параметризованные: значения передаются отдельно от текста
запроса через знаки «?», а не вклеиваются в строку. Так введённое пользователем
никогда не становится частью SQL-команды.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "kopilka.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    password_hash  TEXT    NOT NULL,              -- только хеш argon2, не сам пароль
    monthly_budget INTEGER NOT NULL DEFAULT 65500 CHECK (monthly_budget > 0),
    created_at     TEXT    NOT NULL               -- дата и время в формате ISO
);

CREATE TABLE IF NOT EXISTS categories (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT    NOT NULL UNIQUE,         -- короткое имя для адреса: groceries
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL,
    icon          TEXT    NOT NULL,                -- путь к иконке
    icon_alt      TEXT    NOT NULL,
    monthly_limit INTEGER NOT NULL CHECK (monthly_limit > 0),
    essential     INTEGER NOT NULL CHECK (essential IN (0, 1))  -- 1 — обязательные расходы
);

CREATE TABLE IF NOT EXISTS expenses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category_id       INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    amount            INTEGER NOT NULL CHECK (amount > 0),    -- сумма в рублях
    spent_on          TEXT    NOT NULL,                       -- дата траты ГГГГ-ММ-ДД
    title             TEXT    NOT NULL,
    note              TEXT    NOT NULL DEFAULT '',
    original_amount   REAL,                                   -- сумма в валюте, если была
    original_currency TEXT,                                   -- код валюты: USD, EUR…
    place             TEXT,                                   -- место траты (Nominatim)
    place_lat         REAL,
    place_lon         REAL,
    created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS expenses_user_date ON expenses (user_id, spent_on);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,                -- хеш SHA-256 от токена из cookie
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    topic      TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def connect():
    """Открывает соединение. Строки результата можно читать по именам столбцов."""
    DB_PATH.parent.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")  # SQLite проверяет связи только с этим флагом
    # Встроенные LOWER и LIKE в SQLite не различают регистр только у латиницы.
    # Для поиска по русскому тексту добавляем свою функцию на Python: py_lower('Продукты') = 'продукты'
    connection.create_function("py_lower", 1, lambda text: text.lower() if text else text, deterministic=True)
    return connection


def get_db():
    """Зависимость FastAPI: одно соединение на один запрос, после ответа закрывается."""
    connection = connect()
    try:
        yield connection
    finally:
        connection.close()


def init_db():
    """Создаёт таблицы, если их ещё нет, и заполняет пустую базу начальными данными."""
    from .seed import seed_if_empty

    connection = connect()
    try:
        connection.executescript(SCHEMA)
        seed_if_empty(connection)
    finally:
        connection.close()
