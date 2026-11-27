"""Поиск мест через Nominatim — геокодер OpenStreetMap.

Пользователь вводит название магазина, кафе или адрес, а сервер спрашивает
у Nominatim, где это находится, и возвращает несколько вариантов с координатами.
Запрос к Nominatim делает сервер, а не браузер, чтобы соблюсти правила сервиса:
  * у каждого запроса есть заголовок User-Agent с названием приложения;
  * не чаще одного запроса в секунду — следующий ждёт, пока пройдёт секунда;
  * одинаковые запросы не повторяются: ответы хранятся в памяти сутки;
  * поиск запускается только по кнопке, а не при каждой набранной букве.
Правила: https://operations.osmfoundation.org/policies/nominatim/
"""

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# Адрес можно заменить переменной окружения — например, на свой сервер Nominatim
NOMINATIM_URL = os.environ.get("KOPILKA_NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
USER_AGENT = "Kopilka/3.0 (student project; https://github.com/mikeee1113/kopilka)"
TIMEOUT_SECONDS = 8
CACHE_SECONDS = 24 * 60 * 60
MAX_RESULTS = 5

_cache: dict[str, tuple[float, list[dict]]] = {}
_lock = threading.Lock()
_last_request_at = 0.0


class PlacesError(Exception):
    """Ошибка поиска с понятным пользователю текстом."""


def _request(query: str) -> list:
    params = urllib.parse.urlencode({
        "q": query,
        "format": "jsonv2",
        "limit": MAX_RESULTS,
        "accept-language": "ru",
    })
    request = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        raise PlacesError(f"Сервис карт ответил ошибкой {error.code}.") from error
    except TimeoutError as error:
        raise PlacesError(f"Сервис карт не ответил за {TIMEOUT_SECONDS} секунд.") from error
    except (urllib.error.URLError, OSError) as error:
        raise PlacesError("Не удалось связаться с сервисом карт OpenStreetMap.") from error
    except ValueError as error:
        raise PlacesError("Сервис карт прислал данные в неожиданном виде.") from error
    if not isinstance(data, list):
        raise PlacesError("Сервис карт прислал данные в неожиданном виде.")
    return data


def _simplify(item: dict) -> dict | None:
    """Из ответа Nominatim оставляем только то, что нужно странице."""
    try:
        address = str(item["display_name"])
        return {
            "name": str(item.get("name") or address.split(",")[0]),
            "address": address,
            "lat": round(float(item["lat"]), 6),
            "lon": round(float(item["lon"]), 6),
        }
    except (AttributeError, KeyError, TypeError, ValueError):
        return None


def search_places(query: str) -> list[dict]:
    """Ищет места по тексту и возвращает до пяти вариантов."""
    global _last_request_at
    key = " ".join(query.casefold().split())
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]

    # Блокировка — чтобы два одновременных поиска не ушли в одну и ту же секунду
    with _lock:
        wait = 1.0 - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        try:
            raw = _request(query)
        finally:
            _last_request_at = time.monotonic()

    places = [place for place in map(_simplify, raw) if place is not None]
    _cache[key] = (time.monotonic(), places)
    return places
