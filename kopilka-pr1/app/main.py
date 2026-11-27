"""Сервер «Копилки»: API на FastAPI и раздача страниц сайта.

Запуск из папки проекта:  python -m uvicorn app.main:app --reload
Сайт откроется по адресу http://127.0.0.1:8000, описание API — http://127.0.0.1:8000/docs

Адреса API (все ответы — JSON):
  Без входа:
    GET    /api/categories            список категорий
    GET    /api/categories/{slug}     одна категория
    POST   /api/register              регистрация, сразу выполняет вход
    POST   /api/login                 вход
    POST   /api/logout                выход
    GET    /api/session               кто вошёл (гостю — user: null)
    POST   /api/feedback              сообщение из формы обратной связи
  Только после входа (иначе 401):
    GET    /api/me                    профиль и статистика
    PATCH  /api/me                    изменить имя или бюджет
    GET    /api/expenses              свои записи: фильтр, сортировка, страницы
    GET    /api/expenses/{id}         одна своя запись
    POST   /api/expenses              добавить запись
    DELETE /api/expenses/{id}         удалить свою запись
    GET    /api/summary               итоги месяца по категориям
    GET    /api/places?q=…            поиск места через OpenStreetMap
"""

import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Cookie, Depends, FastAPI, Query, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .db import get_db, init_db
from .places import PlacesError, search_places
from .schemas import ExpenseIn, FeedbackIn, LoginIn, ProfileIn, RegisterIn
from .security import (
    DUMMY_HASH,
    SESSION_COOKIE,
    SESSION_DAYS,
    create_session,
    delete_expired_sessions,
    delete_session,
    hash_password,
    now_iso,
    user_by_token,
    verify_password,
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
SECURE_SESSION_COOKIES = os.getenv("KOPILKA_SECURE_COOKIES") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # при первом запуске создаёт файл базы и заполняет его
    yield


app = FastAPI(
    title="Копилка — API",
    description="Учёт личных расходов. Учебный проект, вариант 23.",
    version="3.0",
    lifespan=lifespan,
)


# ---------- ошибки ----------

class ApiError(Exception):
    """Ошибка с кодом ответа и текстом для пользователя.
    field — имя поля формы, к которому относится ошибка (если относится)."""

    def __init__(self, status: int, message: str, field: str | None = None):
        self.status = status
        self.message = message
        self.field = field


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, error: ApiError):
    content = {"detail": error.message}
    if error.field:
        content["errors"] = [{"field": error.field, "message": error.message}]
    return JSONResponse(content, status_code=error.status)


# Названия полей для сообщений, которые Pydantic формирует сам (не наши проверки)
FIELD_LABELS = {
    "amount": "Сумма",
    "category": "Категория",
    "spent_on": "Дата",
    "title": "Название",
    "note": "Комментарий",
    "original_amount": "Сумма в валюте",
    "original_currency": "Валюта",
    "place": "Место",
    "place_lat": "Широта",
    "place_lon": "Долгота",
    "name": "Имя",
    "email": "Почта",
    "password": "Пароль",
    "monthly_budget": "Бюджет",
    "topic": "Тема",
    "message": "Сообщение",
    "date_from": "С даты",
    "date_to": "По дату",
    "sort": "Сортировка",
    "limit": "Количество",
    "offset": "Сдвиг",
    "month": "Месяц",
    "q": "Запрос",
    "expense_id": "Номер записи",
}


def russian_message(error: dict, field: str) -> str:
    """Текст ошибки по-русски. Наши проверки (value_error) уже написаны по-русски,
    остальные типы ошибок Pydantic переводим по таблице."""
    kind = error["type"]
    label = FIELD_LABELS.get(field, field)
    if kind == "value_error":
        return str(error["ctx"]["error"])
    if kind == "missing":
        return "В запросе нет данных." if not field else f"Заполните поле «{label}»."
    if kind in ("int_parsing", "int_type", "int_from_float"):
        return f"«{label}» — целое число."
    if kind in ("float_parsing", "float_type", "finite_number"):
        return f"«{label}» — число."
    if kind.startswith("date"):
        return f"«{label}» — дата в формате ГГГГ-ММ-ДД."
    if kind == "string_type":
        return f"«{label}» — текст."
    if kind == "literal_error":
        return f"«{label}»: выберите значение из списка."
    if kind in ("greater_than_equal", "less_than_equal", "greater_than", "less_than"):
        return f"«{label}»: число вне допустимых границ."
    if kind == "string_too_short":
        return f"«{label}»: слишком коротко, нужно хотя бы {error['ctx']['min_length']} символа."
    if kind == "string_too_long":
        return f"«{label}»: не длиннее {error['ctx']['max_length']} символов."
    if kind == "string_pattern_mismatch":
        return "Месяц — в формате ГГГГ-ММ, например 2026-09." if field == "month" else f"«{label}»: неверный формат."
    if kind == "json_invalid":
        return "Тело запроса — не JSON."
    if kind in ("model_attributes_type", "dict_type"):
        return "Данные нужно прислать объектом JSON."
    return f"«{label}»: неверное значение."


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, error: RequestValidationError):
    """Ошибки проверки данных: 422 и список «поле — что не так»."""
    errors = []
    for item in error.errors():
        # loc выглядит как ("body", "amount") или ("query", "limit")
        path = [part for part in item["loc"] if part not in ("body", "query", "path", "cookie")]
        field = str(path[0]) if path and isinstance(path[0], str) else ""
        errors.append({"field": field, "message": russian_message(item, field)})
    detail = errors[0]["message"] if len(errors) == 1 else f"Проверьте данные: ошибок — {len(errors)}."
    return JSONResponse({"detail": detail, "errors": errors}, status_code=422)


STANDARD_DETAILS = {
    401: "Нужно войти в аккаунт.",
    404: "Не найдено.",
    405: "Этот метод для адреса не поддерживается.",
}


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, error: StarletteHTTPException):
    """Стандартные ошибки API тоже отдаём в JSON и по-русски."""
    if request.url.path.startswith("/api/"):
        detail = STANDARD_DETAILS.get(error.status_code, str(error.detail))
        return JSONResponse({"detail": detail}, status_code=error.status_code)
    return await http_exception_handler(request, error)


# ---------- зависимости ----------

Db = Annotated[sqlite3.Connection, Depends(get_db)]


def current_user(db: Db, token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None):
    """Пользователь, который выполнил вход. Нет входа — ответ 401, обработчик не запускается."""
    user = user_by_token(db, token)
    if user is None:
        raise ApiError(401, "Нужно войти в аккаунт.")
    return user


User = Annotated[sqlite3.Row, Depends(current_user)]


# ---------- преобразование строк базы в ответы ----------

def user_json(row) -> dict:
    # хеш пароля никогда не уходит в ответ
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "monthly_budget": row["monthly_budget"],
        "created_at": row["created_at"],
    }


def category_json(row) -> dict:
    return {
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "icon": row["icon"],
        "icon_alt": row["icon_alt"],
        "monthly_limit": row["monthly_limit"],
        "essential": bool(row["essential"]),
    }


EXPENSE_SELECT = """
    SELECT e.id, e.amount, e.spent_on, e.title, e.note,
           e.original_amount, e.original_currency, e.place, e.place_lat, e.place_lon, e.created_at,
           c.slug AS category_slug, c.name AS category_name,
           c.icon AS category_icon, c.icon_alt AS category_icon_alt
    FROM expenses AS e
    JOIN categories AS c ON c.id = e.category_id
"""


def expense_json(row) -> dict:
    return {
        "id": row["id"],
        "amount": row["amount"],
        "spent_on": row["spent_on"],
        "title": row["title"],
        "note": row["note"],
        "category": {
            "slug": row["category_slug"],
            "name": row["category_name"],
            "icon": row["category_icon"],
            "icon_alt": row["category_icon_alt"],
        },
        "original": (
            {"amount": row["original_amount"], "currency": row["original_currency"]}
            if row["original_currency"] else None
        ),
        "place": (
            {"name": row["place"], "lat": row["place_lat"], "lon": row["place_lon"]}
            if row["place"] else None
        ),
        "created_at": row["created_at"],
    }


def find_own_expense(db, expense_id: int, user_id: int):
    """Запись ищется сразу по номеру и владельцу: чужая запись выглядит как несуществующая."""
    row = db.execute(EXPENSE_SELECT + " WHERE e.id = ? AND e.user_id = ?", (expense_id, user_id)).fetchone()
    if row is None:
        raise ApiError(404, "Запись не найдена.")
    return row


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        secure=SECURE_SESSION_COOKIES,
        httponly=True,    # скрипты страницы не видят cookie
        samesite="lax",   # чужой сайт не сможет отправить запрос от имени пользователя
        path="/",
    )


# ---------- категории ----------

@app.get("/api/categories", tags=["Категории"])
def list_categories(db: Db):
    rows = db.execute("SELECT * FROM categories ORDER BY id").fetchall()
    return [category_json(row) for row in rows]


@app.get("/api/categories/{slug}", tags=["Категории"])
def get_category(slug: str, db: Db):
    row = db.execute("SELECT * FROM categories WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        raise ApiError(404, "Такой категории нет.")
    return category_json(row)


# ---------- регистрация и вход ----------

@app.post("/api/register", status_code=201, tags=["Пользователи"])
def register(data: RegisterIn, response: Response, db: Db):
    exists = db.execute("SELECT 1 FROM users WHERE email = ?", (data.email,)).fetchone()
    if exists:
        raise ApiError(409, "Пользователь с такой почтой уже зарегистрирован. Войдите или укажите другую почту.", "email")
    cursor = db.execute(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (data.email, data.name, hash_password(data.password), now_iso()),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    set_session_cookie(response, create_session(db, user["id"]))
    return user_json(user)


@app.post("/api/login", tags=["Пользователи"])
def login(data: LoginIn, response: Response, db: Db):
    user = db.execute("SELECT * FROM users WHERE email = ?", (data.email,)).fetchone()
    # Хеш проверяется, даже если почты нет: по времени ответа нельзя понять, есть ли такой пользователь
    password_ok = verify_password(user["password_hash"] if user else DUMMY_HASH, data.password)
    if user is None or not password_ok:
        raise ApiError(401, "Неверная почта или пароль.")
    delete_expired_sessions(db)
    set_session_cookie(response, create_session(db, user["id"]))
    return user_json(user)


@app.post("/api/logout", status_code=204, tags=["Пользователи"])
def logout(response: Response, db: Db, token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None):
    delete_session(db, token)
    response.delete_cookie(
        SESSION_COOKIE, path="/", secure=SECURE_SESSION_COOKIES, httponly=True, samesite="lax",
    )


@app.get("/api/session", tags=["Пользователи"])
def get_session(db: Db, token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None):
    """Кто вошёл. Гостю — не ошибка 401, а user: null: по этому ответу каждая
    страница решает, показывать в меню «Войти» или «Профиль»."""
    user = user_by_token(db, token)
    return {"user": user_json(user) if user else None}


@app.get("/api/me", tags=["Пользователи"])
def get_me(user: User, db: Db):
    stats = db.execute(
        """SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total,
                  MIN(spent_on) AS first_date, MAX(spent_on) AS last_date
           FROM expenses WHERE user_id = ?""",
        (user["id"],),
    ).fetchone()
    return {**user_json(user), "stats": dict(stats)}


@app.patch("/api/me", tags=["Пользователи"])
def update_me(data: ProfileIn, user: User, db: Db):
    if data.name is not None:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (data.name, user["id"]))
    if data.monthly_budget is not None:
        db.execute("UPDATE users SET monthly_budget = ? WHERE id = ?", (data.monthly_budget, user["id"]))
    db.commit()
    return user_json(db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())


# ---------- расходы ----------

# Сортировка выбирается только из этого списка: текст из адреса в SQL не попадает
SORT_ORDERS = {
    "date-desc": "e.spent_on DESC, e.id DESC",
    "date-asc": "e.spent_on ASC, e.id ASC",
    "amount-desc": "e.amount DESC, e.id DESC",
    "amount-asc": "e.amount ASC, e.id ASC",
}


@app.get("/api/expenses", tags=["Расходы"])
def list_expenses(
    user: User,
    db: Db,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    sort: Literal["date-desc", "date-asc", "amount-desc", "amount-asc"] = "date-desc",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Записи текущего пользователя. Все условия необязательные и складываются через И."""
    if date_from and date_to and date_from > date_to:
        raise ApiError(422, "Конец периода раньше начала.", "date_to")

    conditions = ["e.user_id = ?"]
    params: list = [user["id"]]
    if category:
        conditions.append("c.slug = ?")
        params.append(category)
    if date_from:
        conditions.append("e.spent_on >= ?")
        params.append(date_from.isoformat())
    if date_to:
        conditions.append("e.spent_on <= ?")
        params.append(date_to.isoformat())
    if q and q.strip():
        # Поиск без учёта регистра; % и _ внутри запроса ищутся как обычные символы
        text = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("(py_lower(e.title) LIKE ? ESCAPE '\\' OR py_lower(e.note) LIKE ? ESCAPE '\\')")
        params += [f"%{text}%", f"%{text}%"]
    where = " WHERE " + " AND ".join(conditions)

    totals = db.execute(
        "SELECT COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS total FROM expenses AS e"
        " JOIN categories AS c ON c.id = e.category_id" + where,
        params,
    ).fetchone()
    rows = db.execute(
        EXPENSE_SELECT + where + f" ORDER BY {SORT_ORDERS[sort]} LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    return {
        "items": [expense_json(row) for row in rows],
        "count": totals["count"],   # сколько записей подходит под условия всего
        "total": totals["total"],   # их общая сумма
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/expenses/{expense_id}", tags=["Расходы"])
def get_expense(expense_id: int, user: User, db: Db):
    return expense_json(find_own_expense(db, expense_id, user["id"]))


@app.post("/api/expenses", status_code=201, tags=["Расходы"])
def create_expense(data: ExpenseIn, user: User, db: Db):
    category = db.execute("SELECT id, name FROM categories WHERE slug = ?", (data.category,)).fetchone()
    if category is None:
        raise ApiError(422, "Такой категории нет — выберите из списка.", "category")
    cursor = db.execute(
        """INSERT INTO expenses (user_id, category_id, amount, spent_on, title, note,
                                 original_amount, original_currency, place, place_lat, place_lon, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            user["id"], category["id"], data.amount, data.spent_on.isoformat(),
            data.title or category["name"], data.note,
            data.original_amount, data.original_currency,
            data.place, data.place_lat, data.place_lon, now_iso(),
        ),
    )
    db.commit()
    return expense_json(find_own_expense(db, cursor.lastrowid, user["id"]))


@app.delete("/api/expenses/{expense_id}", status_code=204, tags=["Расходы"])
def delete_expense(expense_id: int, user: User, db: Db):
    find_own_expense(db, expense_id, user["id"])  # 404, если записи нет или она чужая
    db.execute("DELETE FROM expenses WHERE id = ? AND user_id = ?", (expense_id, user["id"]))
    db.commit()


@app.get("/api/summary", tags=["Расходы"])
def month_summary(
    user: User,
    db: Db,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
):
    """Итоги месяца по всем категориям. Без параметра — последний месяц, в котором есть записи."""
    months = [
        row["month"] for row in db.execute(
            "SELECT DISTINCT substr(spent_on, 1, 7) AS month FROM expenses WHERE user_id = ? ORDER BY month DESC",
            (user["id"],),
        )
    ]
    if month is None:
        month = months[0] if months else date.today().strftime("%Y-%m")
    rows = db.execute(
        """SELECT c.slug, c.name, c.icon, c.icon_alt, c.monthly_limit,
                  COALESCE(SUM(e.amount), 0) AS spent, COUNT(e.id) AS count
           FROM categories AS c
           LEFT JOIN expenses AS e
                  ON e.category_id = c.id AND e.user_id = ? AND substr(e.spent_on, 1, 7) = ?
           GROUP BY c.id
           ORDER BY spent DESC, c.id""",
        (user["id"], month),
    ).fetchall()
    total = sum(row["spent"] for row in rows)
    return {
        "month": month,
        "months": months,     # месяцы, в которых у пользователя есть записи
        "total": total,
        "count": sum(row["count"] for row in rows),
        "budget": user["monthly_budget"],
        "left": user["monthly_budget"] - total,
        "categories": [dict(row) for row in rows],
    }


# ---------- поиск места (Nominatim / OpenStreetMap) ----------

@app.get("/api/places", tags=["Места"])
def find_places(user: User, q: Annotated[str, Query(min_length=3, max_length=200)]):
    """Только для вошедших: так посторонние не смогут гонять запросы к OpenStreetMap через наш сервер."""
    try:
        return {"query": q, "results": search_places(q)}
    except PlacesError as error:
        raise ApiError(502, str(error)) from error


# ---------- обратная связь ----------

@app.post("/api/feedback", status_code=201, tags=["Обратная связь"])
def send_feedback(data: FeedbackIn, db: Db):
    cursor = db.execute(
        "INSERT INTO feedback (name, email, topic, message, created_at) VALUES (?, ?, ?, ?, ?)",
        (data.name, data.email, data.topic, data.message, now_iso()),
    )
    db.commit()
    return {"id": cursor.lastrowid, "detail": "Сообщение сохранено. Ответим на указанную почту."}


# ---------- всё остальное ----------

@app.get("/api/health", tags=["Состояние"])
def health(db: Db):
    db.execute("SELECT 1 FROM categories LIMIT 1").fetchone()
    return {"status": "ok"}


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_fallback(request: Request):
    """Неизвестный адрес API — 404, известный адрес с другим методом — 405."""
    for route in app.routes:
        if isinstance(route, APIRoute) and route.endpoint is not api_fallback \
                and route.path_regex.match(request.url.path):
            raise ApiError(405, "Этот метод для адреса не поддерживается.")
    raise ApiError(404, "Такого адреса в API нет.")


# Страницы сайта. html=True: «/» открывает index.html, а для несуществующих
# адресов показывается 404.html с кодом ответа 404.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="site")
