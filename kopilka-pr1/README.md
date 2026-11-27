# Копилка — учёт личных расходов

Учебный проект по дисциплине «Введение в интернет-технологии», вариант 23.
Сайт с сервером на FastAPI и базой данных SQLite. Для ПР № 4 добавлен запуск в Docker с постоянным томом для базы и подготовлено развёртывание по HTTPS.

Рабочий сайт на Railway: https://kopilka-production-4ac238cf.up.railway.app/

## Как запустить в Docker

В папке `kopilka-pr1` выполните `docker compose up --build -d`. Сайт откроется по адресу http://127.0.0.1:8000, проверка состояния — http://127.0.0.1:8000/api/health.

Для остановки выполните `docker compose down`. SQLite хранится в томе `kopilka-data` и сохраняется после остановки, пересборки и замены контейнера. Это отдельная база от `data/kopilka.db`, которая используется при запуске через `start.bat`.

## Развёртывание на Railway

1. Создайте сервис из этого репозитория и укажите `/kopilka-pr1` в **Settings → Root Directory**. Railway обнаружит `Dockerfile` в этой папке, а приложение возьмёт номер порта из переменной `PORT`.
2. Подключите к сервису постоянный том с путём `/app/data`. В **Variables** задайте `RAILWAY_RUN_UID=0` для подготовки диска Railway и `KOPILKA_SECURE_COOKIES=1` для защищённых сессионных cookie. После подготовки диска приложение запускается от пользователя `kopilka`.
3. В **Settings** укажите `/api/health` как **Healthcheck Path**. В **Public Networking** выберите **Generate Domain**. Railway выдаст HTTPS-адрес и будет управлять сертификатом.
4. По публичному адресу проверьте главную, регистрацию, вход, добавление расхода и `/api/health`. После повторного развёртывания ранее созданный аккаунт и расход должны сохраниться.

## Как запустить (Windows)

1. Установите Python 3.10 или новее с python.org (галочка «Add python.exe to PATH»).
2. Дважды щёлкните `start.bat` в папке проекта. Он создаст окружение `.venv`, установит зависимости и запустит сервер.
3. Откройте в браузере http://127.0.0.1:8000 — сайт, http://127.0.0.1:8000/docs — описание API.

Вручную (PowerShell, из папки проекта):

```
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Файл базы `data/kopilka.db` создаётся и заполняется сам при первом запуске; в репозиторий он не попадает (`.gitignore`).
Чтобы начать с чистыми данными, остановите сервер (Ctrl+C) и удалите этот файл.

**Демо-аккаунт:** `demo@example.com` / `kopilka-demo` — 24 записи за сентябрь 2026 года.

## Структура проекта

```
app/            сервер
  main.py       адреса API, проверка входа, раздача страниц
  db.py         подключение к SQLite и таблицы
  schemas.py    проверка данных запросов (Pydantic)
  security.py   хеширование паролей (argon2) и сессии
  places.py     поиск мест через Nominatim (OpenStreetMap)
  seed.py       начальные данные
static/         страницы сайта, стили, скрипты, картинки
data/           файл базы (создаётся сам)
docs/           техническое задание и макет
Dockerfile      образ приложения
compose.yaml    локальный запуск с постоянным томом SQLite
start.bat       запуск в Windows
```

## База данных

Пять таблиц; главная — `expenses` (24 начальные записи).

| Таблица | Поля | Связи |
|---|---|---|
| `users` — пользователи | `id` INTEGER PK, `email` TEXT UNIQUE, `name` TEXT, `password_hash` TEXT (хеш argon2), `monthly_budget` INTEGER, `created_at` TEXT | — |
| `categories` — категории | `id` INTEGER PK, `slug` TEXT UNIQUE, `name` TEXT, `description` TEXT, `icon` TEXT, `icon_alt` TEXT, `monthly_limit` INTEGER, `essential` INTEGER (0/1) | — |
| `expenses` — расходы | `id` INTEGER PK, `user_id` INTEGER, `category_id` INTEGER, `amount` INTEGER (₽), `spent_on` TEXT (ГГГГ-ММ-ДД), `title` TEXT, `note` TEXT, `original_amount` REAL, `original_currency` TEXT, `place` TEXT, `place_lat` REAL, `place_lon` REAL, `created_at` TEXT | `user_id` → `users.id` (многие к одному, ON DELETE CASCADE); `category_id` → `categories.id` (многие к одному, ON DELETE RESTRICT) |
| `sessions` — сессии входа | `token_hash` TEXT PK (SHA-256 токена), `user_id` INTEGER, `created_at` TEXT, `expires_at` TEXT | `user_id` → `users.id` (ON DELETE CASCADE) |
| `feedback` — обратная связь | `id` INTEGER PK, `name` TEXT, `email` TEXT, `topic` TEXT, `message` TEXT, `created_at` TEXT | — |

## API

| Метод и адрес | Что делает | Вход |
|---|---|---|
| `GET /api/health` | проверка запуска приложения и доступа к базе | не нужен |
| `GET /api/categories` | список категорий | не нужен |
| `GET /api/categories/{slug}` | одна категория (404, если нет) | не нужен |
| `POST /api/register` | регистрация, сразу вход (201; 409 — почта занята) | не нужен |
| `POST /api/login` | вход (401 — неверная почта или пароль) | не нужен |
| `POST /api/logout` | выход | — |
| `GET /api/session` | кто вошёл (гостю — `user: null`) | не нужен |
| `GET /api/me`, `PATCH /api/me` | профиль со статистикой; изменить имя и бюджет | нужен |
| `GET /api/expenses` | свои записи: `category`, `date_from`, `date_to`, `q`, `sort`, `limit`, `offset` | нужен |
| `GET /api/expenses/{id}` | одна своя запись (чужая — 404) | нужен |
| `POST /api/expenses` | добавить запись (201) | нужен |
| `DELETE /api/expenses/{id}` | удалить свою запись (204) | нужен |
| `GET /api/summary?month=ГГГГ-ММ` | итоги месяца по категориям | нужен |
| `GET /api/places?q=…` | поиск места через OpenStreetMap | нужен |
| `POST /api/feedback` | сообщение из формы «Контакты» (201) | не нужен |

Ошибки приходят в JSON по-русски: `{"detail": "...", "errors": [{"field": "...", "message": "..."}]}`.

## Безопасность

- Пароль хранится только как хеш argon2 (библиотека argon2-cffi).
- После входа браузер получает случайный токен в cookie `kopilka_session` (HttpOnly, SameSite=Lax, 7 дней); в базе лежит только его хеш.
- Все SQL-запросы параметризованные (`?`); сортировка выбирается из списка, а не вставляется из адреса.
- Права проверяются на сервере: каждый запрос к записям ищет запись по номеру и владельцу.

## Внешние данные

- **Курсы ЦБ РФ** — https://www.cbr-xml-daily.ru/daily_json.js, запрашиваются браузером на странице «Добавить запись».
- **Nominatim (OpenStreetMap)** — https://nominatim.org/, поиск места траты. Запрос делает сервер (`app/places.py`): с заголовком User-Agent, не чаще раза в секунду, с запоминанием ответов на сутки, только по кнопке «Найти». Данные © участники OpenStreetMap.
