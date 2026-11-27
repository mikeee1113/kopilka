"""Что сервер принимает в запросах.

Каждая модель описывает тело одного запроса. Pydantic проверяет поля ещё до того,
как запрос попадёт в обработчик: неверные данные получают ответ 422 с понятным
текстом ошибки у каждого поля, а в базу попадает только проверенное.
Правила совпадают с проверкой форм в браузере (js/*.js), но сервер не доверяет
браузеру и проверяет всё ещё раз.
"""

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, ValidationInfo, field_validator

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
NAME_PATTERN = re.compile(r"^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]*$")
CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")

MIN_DATE = date(2020, 1, 1)
MAX_AMOUNT = 1_000_000
PASSWORD_MIN = 8
PASSWORD_MAX = 128


def check_name(value: str) -> str:
    value = value.strip()
    if value == "":
        raise ValueError("Введите имя.")
    if len(value) < 2:
        raise ValueError("Имя слишком короткое: нужно хотя бы 2 буквы.")
    if len(value) > 60:
        raise ValueError("Имя — не длиннее 60 символов.")
    if not NAME_PATTERN.match(value):
        raise ValueError("В имени могут быть только буквы, пробел, дефис и апостроф.")
    return value


def check_email(value: str) -> str:
    value = value.strip()
    if value == "":
        raise ValueError("Введите адрес электронной почты.")
    if len(value) > 254 or not EMAIL_PATTERN.match(value):
        raise ValueError("Проверьте адрес: он должен быть вида name@example.com.")
    return value.lower()  # почта не зависит от регистра букв


# Типы полей с готовой проверкой — используются в нескольких моделях
Name = Annotated[str, AfterValidator(check_name)]
Email = Annotated[str, AfterValidator(check_email)]


class RegisterIn(BaseModel):
    name: Name
    email: Email
    password: str

    @field_validator("password")
    @classmethod
    def check_password(cls, value: str) -> str:
        # пробелы в пароле не обрезаем: это часть пароля
        if value == "":
            raise ValueError("Придумайте пароль.")
        if len(value) < PASSWORD_MIN:
            raise ValueError(f"Пароль слишком короткий: нужно хотя бы {PASSWORD_MIN} символов.")
        if len(value) > PASSWORD_MAX:
            raise ValueError(f"Пароль — не длиннее {PASSWORD_MAX} символов.")
        if value.isdigit():
            raise ValueError("Пароль только из цифр легко подобрать: добавьте буквы.")
        return value


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("Введите адрес электронной почты.")
        return value.lower()

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, value: str) -> str:
        if value == "":
            raise ValueError("Введите пароль.")
        return value


class ProfileIn(BaseModel):
    """Изменение профиля: можно прислать только те поля, что меняются."""

    name: Name | None = None
    monthly_budget: int | None = None

    @field_validator("monthly_budget")
    @classmethod
    def check_budget(cls, value: int | None) -> int | None:
        if value is not None and not 1000 <= value <= 10_000_000:
            raise ValueError("Бюджет — от 1 000 до 10 000 000 ₽ в месяц.")
        return value


class ExpenseIn(BaseModel):
    """Новая запись о расходе. Сумма приходит уже в рублях, целым числом."""

    amount: int
    category: str
    spent_on: date
    title: str = ""
    note: str = ""
    original_amount: float | None = None   # сумма в валюте, если трата была не в рублях
    # validate_default: проверка пары «сумма — валюта» и «широта — долгота»
    # запускается, даже если второе поле не прислали
    original_currency: str | None = Field(default=None, validate_default=True)
    place: str | None = None               # место из поиска OpenStreetMap
    place_lat: float | None = None
    place_lon: float | None = Field(default=None, validate_default=True)

    @field_validator("amount")
    @classmethod
    def check_amount(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Сумма должна быть больше нуля.")
        if value > MAX_AMOUNT:
            raise ValueError("Слишком большая сумма: не больше 1 000 000 ₽.")
        return value

    @field_validator("category")
    @classmethod
    def check_category(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("Выберите категорию.")
        return value

    @field_validator("spent_on")
    @classmethod
    def check_date(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("Дата не может быть позже сегодняшней.")
        if value < MIN_DATE:
            raise ValueError("Слишком давняя дата: не раньше 1 января 2020 года.")
        return value

    @field_validator("title")
    @classmethod
    def check_title(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 80:
            raise ValueError("Название — не длиннее 80 символов.")
        return value

    @field_validator("note")
    @classmethod
    def check_note(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 200:
            raise ValueError("Комментарий — не длиннее 200 символов.")
        return value

    @field_validator("original_amount")
    @classmethod
    def check_original_amount(cls, value: float | None) -> float | None:
        if value is not None and not 0 < value <= MAX_AMOUNT * 100:
            raise ValueError("Сумма в валюте должна быть больше нуля.")
        return value

    @field_validator("original_currency")
    @classmethod
    def check_currency(cls, value: str | None, info: ValidationInfo) -> str | None:
        has_amount = info.data.get("original_amount") is not None
        if value is None:
            if has_amount:
                raise ValueError("Укажите код валюты для суммы в валюте.")
            return None
        if not CURRENCY_PATTERN.match(value) or value == "RUB":
            raise ValueError("Код валюты — три латинские буквы, например USD.")
        if not has_amount:
            raise ValueError("Для валюты нужна и сумма в этой валюте.")
        return value

    @field_validator("place")
    @classmethod
    def check_place(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > 200:
            raise ValueError("Название места — не длиннее 200 символов.")
        return value or None

    @field_validator("place_lat")
    @classmethod
    def check_lat(cls, value: float | None) -> float | None:
        if value is not None and not -90 <= value <= 90:
            raise ValueError("Широта — от −90 до 90.")
        return value

    @field_validator("place_lon")
    @classmethod
    def check_lon(cls, value: float | None, info: ValidationInfo) -> float | None:
        if value is not None and not -180 <= value <= 180:
            raise ValueError("Долгота — от −180 до 180.")
        if (value is None) != (info.data.get("place_lat") is None):
            raise ValueError("Координаты места нужны обе: и широта, и долгота.")
        return value


class FeedbackIn(BaseModel):
    name: Name
    email: Email
    topic: Literal["question", "bug", "idea"]
    message: str

    @field_validator("message")
    @classmethod
    def check_message(cls, value: str) -> str:
        value = value.strip()
        if value == "":
            raise ValueError("Напишите сообщение.")
        if len(value) < 10:
            raise ValueError(f"Слишком коротко: нужно хотя бы 10 символов, сейчас {len(value)}.")
        if len(value) > 1000:
            raise ValueError("Сообщение — не длиннее 1000 символов.")
        return value
