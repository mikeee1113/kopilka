'use strict';

/*
 * Общие функции «Копилки» для всех страниц:
 * запросы к серверу (api), вход пользователя и пункт меню «Войти» / «Профиль»,
 * форматирование сумм и дат, разбор суммы из поля ввода,
 * вывод сообщений об ошибках рядом с полем и проверка формы целиком,
 * строка записи о расходе для списков.
 * Файл подключается раньше остальных скриптов страницы.
 */

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOMINATIVE = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/* Создаёт элемент с параметрами и содержимым:
   el('p', { className: 'lead' }, 'Текст', другойЭлемент).
   Строки добавляются как текст, а не как HTML. */
function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in element) {
      element[key] = value;
    } else {
      element.setAttribute(key, value);
    }
  }
  element.append(...children);
  return element;
}

/* ---------- запросы к серверу ---------- */

/* Ошибка ответа сервера: код, текст для пользователя и ошибки по полям */
class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/*
 * Запрос к API сервера. Возвращает данные из ответа (JSON) или null для ответа без тела.
 * При ошибке выбрасывает ApiError с текстом, который прислал сервер.
 * Cookie сессии браузер отправляет сам — скрипт её не видит (HttpOnly).
 */
async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'Сервер не отвечает. Проверьте, что он запущен (файл start.bat), и обновите страницу.');
  }
  if (response.status === 204) return null;
  let data = null;
  try {
    data = await response.json();
  } catch {
    // ответ не JSON — например, страница ошибки прокси
  }
  if (!response.ok) {
    throw new ApiError(response.status, (data && data.detail) || `Сервер ответил ошибкой ${response.status}.`,
      (data && data.errors) || []);
  }
  return data;
}

/* Сообщение над содержимым страницы: ошибка загрузки, «нужно войти» и т. п. */
function showNotice(container, message, { isError = false, linkText = '', linkHref = '' } = {}) {
  const notice = document.createElement('div');
  notice.className = isError ? 'notice is-error' : 'notice';
  notice.setAttribute('role', isError ? 'alert' : 'status');
  const text = document.createElement('p');
  text.textContent = message;
  if (linkText) {
    const link = document.createElement('a');
    link.href = linkHref;
    link.textContent = linkText;
    text.append(' ', link);
  }
  notice.append(text);
  container.replaceChildren(notice);
  return notice;
}

/* ---------- вход пользователя ---------- */

/* Адрес текущей страницы для возврата после входа: «expenses.html?category=cafe» */
function currentPageForReturn() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  return page + window.location.search;
}

function loginUrl() {
  return `login.html?next=${encodeURIComponent(currentPageForReturn())}`;
}

/* Пункт меню «Войти» превращается в «Профиль», когда пользователь вошёл */
function updateAccountLink(user) {
  const link = document.getElementById('nav-account');
  if (!link) return;
  if (user) {
    link.href = 'profile.html';
    link.textContent = 'Профиль';
    link.title = `Вы вошли как ${user.name}`;
  } else {
    link.href = loginUrl();
    link.textContent = 'Войти';
    link.removeAttribute('title');
  }
}

/*
 * Кто вошёл: запрос к /api/session делается один раз при загрузке любой страницы.
 * Обещание даёт пользователя или null, если вход не выполнен.
 * Если сервер недоступен, обещание отклоняется с ApiError.
 */
const currentUser = api('/api/session').then((data) => data.user);

currentUser.then(updateAccountLink, () => updateAccountLink(null));

/*
 * Для страниц только для вошедших: без входа сразу ведёт на страницу входа,
 * а после входа пользователь вернётся обратно.
 */
async function requireUser() {
  const user = await currentUser;
  if (!user) {
    window.location.replace(loginUrl());
    return new Promise(() => {}); // страница уходит, дальше ничего не делаем
  }
  return user;
}

/* 46960 → «46 960 ₽» */
function formatMoney(rubles) {
  return Math.round(rubles).toLocaleString('ru-RU') + ' ₽';
}

/* 81.5234 → «81,52» */
function formatRate(value) {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* «2026-09» → «сентябрь 2026» */
function formatMonth(isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  return `${MONTHS_NOMINATIVE[month - 1]} ${year}`;
}

/* «2026-09» → «сентябре» для фраз «в сентябре» */
function formatMonthIn(isoMonth) {
  const month = Number(isoMonth.split('-')[1]);
  const forms = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  return forms[month - 1];
}

/* Первая буква — заглавная: «сентябрь 2026» → «Сентябрь 2026» */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* «2026-09-18» → «18 сентября»; если год не текущий, он добавляется в конец */
function formatRuDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const text = `${day} ${MONTHS_GENITIVE[month - 1]}`;
  return year === new Date().getFullYear() ? text : `${text} ${year}`;
}

/* Сегодняшняя дата по часам пользователя в виде «ГГГГ-ММ-ДД» — так же записывает дату поле type="date" */
function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/* Склонение по числу: pluralize(3, ['запись', 'записи', 'записей']) → «записи» */
function pluralize(count, forms) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return forms[0];
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return forms[1];
  return forms[2];
}

/* Сумма из текстового поля: «1 250,5» → 1250.5. Если это не число, возвращает NaN. */
function parseAmount(text) {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

/* Показывает текст ошибки в абзаце под полем и отмечает поле как неверное */
function showFieldError(field, message) {
  const error = document.getElementById(`${field.id}-error`);
  error.textContent = message;
  error.hidden = false;
  field.setAttribute('aria-invalid', 'true');
}

/* Убирает ошибку у поля */
function clearFieldError(field) {
  const error = document.getElementById(`${field.id}-error`);
  error.textContent = '';
  error.hidden = true;
  field.removeAttribute('aria-invalid');
}

/*
 * Проверяет одно поле. Правило — функция, которая получает значение поля
 * (без пробелов по краям) и само поле, а возвращает текст ошибки
 * или пустую строку, если всё верно.
 */
function checkField(field, rule) {
  const message = rule(field.value.trim(), field);
  if (message) {
    showFieldError(field, message);
  } else {
    clearFieldError(field);
  }
  return message === '';
}

/*
 * Показывает у полей ошибки, которые вернул сервер (ApiError.errors).
 * fieldNames переводит имя поля на сервере в имя поля формы: { spent_on: 'date' }.
 * Возвращает true, если хотя бы одна ошибка нашла своё поле.
 */
function showServerErrors(form, error, fieldNames = {}) {
  let first = null;
  for (const { field, message } of error.errors || []) {
    const input = form.elements[fieldNames[field] || field];
    if (input && document.getElementById(`${input.id}-error`)) {
      showFieldError(input, message);
      first = first || input;
    }
  }
  if (first) first.focus();
  return first !== null;
}

/* Строка состояния формы: ошибка или успех */
function setFormStatus(form, message, kind = '') {
  const status = form.querySelector('.form-status');
  status.className = kind ? `form-status is-${kind}` : 'form-status';
  status.textContent = message;
}

/*
 * Подключает проверку к форме.
 * rules — объект «имя поля → правило», onValid — функция, которая
 * вызывается, только когда все поля заполнены верно. Если onValid
 * отправляет данные на сервер (async), кнопка отправки неактивна,
 * пока не придёт ответ, — запись не уйдёт дважды.
 */
function setupFormValidation(form, rules, onValid) {
  // Отключаем всплывающие подсказки браузера: ошибки выводим сами, рядом с полем.
  // Без JavaScript атрибуты required продолжат работать как обычно.
  form.noValidate = true;
  const status = form.querySelector('.form-status');

  for (const [name, rule] of Object.entries(rules)) {
    const field = form.elements[name];
    // Ушли с поля — проверяем, но пустое нетронутое поле не ругаем раньше времени
    field.addEventListener('blur', () => {
      if (field.value.trim() !== '' || field.hasAttribute('aria-invalid')) {
        checkField(field, rule);
      }
    });
    // Пользователь исправляет ошибку — сообщение исчезает, как только значение стало верным
    field.addEventListener('input', () => {
      if (field.hasAttribute('aria-invalid')) {
        checkField(field, rule);
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // данные уходят на сервер через fetch, страница не перезагружается
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    const invalidFields = Object.entries(rules)
      .filter(([name, rule]) => !checkField(form.elements[name], rule))
      .map(([name]) => form.elements[name]);

    if (invalidFields.length > 0) {
      status.className = 'form-status is-error';
      status.textContent = `Проверьте форму: ${invalidFields.length} ${pluralize(invalidFields.length, ['поле заполнено', 'поля заполнены', 'полей заполнено'])} с ошибкой.`;
      invalidFields[0].focus();
      return;
    }
    status.className = 'form-status';
    status.textContent = '';
    submit.disabled = true;
    try {
      await onValid(form);
    } finally {
      submit.disabled = false;
    }
  });
}

/* Счётчик символов под многострочным полем: «12 / 200» */
function setupCharCounter(textarea, counter) {
  const update = () => {
    counter.textContent = `${textarea.value.length} / ${textarea.maxLength}`;
  };
  textarea.addEventListener('input', update);
  textarea.form.addEventListener('reset', () => setTimeout(update));
  update();
}

/* ---------- строка записи о расходе ---------- */

/* Ссылка на карту OpenStreetMap с отметкой места */
function osmUrl(place) {
  return `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`;
}

/*
 * Строит пункт списка из записи, которую прислал сервер.
 * Текст пользователя вставляется через textContent, поэтому любые
 * символы в названии и комментарии показываются как текст, а не как HTML.
 * options.showCategory — ссылка на категорию в строке;
 * options.onDelete(expense, item) — если задана, в строке есть кнопка «Удалить».
 */
function createExpenseItem(expense, { showCategory = true, onDelete = null } = {}) {
  const item = document.createElement('li');
  item.className = 'expense';
  item.dataset.id = expense.id;

  const icon = document.createElement('img');
  icon.src = expense.category.icon;
  icon.alt = expense.category.icon_alt;
  icon.width = 40;
  icon.height = 40;

  const body = document.createElement('div');
  body.className = 'expense-body';
  const title = document.createElement('span');
  title.className = 'expense-title';
  title.textContent = expense.title;
  const meta = document.createElement('span');
  meta.className = 'expense-meta';
  const time = document.createElement('time');
  time.dateTime = expense.spent_on;
  time.textContent = formatRuDate(expense.spent_on);
  meta.append(time);
  if (showCategory) {
    const link = document.createElement('a');
    link.href = `category.html?slug=${encodeURIComponent(expense.category.slug)}`;
    link.textContent = expense.category.name;
    meta.append(', ', link);
  }
  if (expense.note) meta.append(`, ${expense.note}`);
  if (expense.original) {
    const original = expense.original.amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    meta.append(`, ${original} ${expense.original.currency} по курсу ЦБ`);
  }
  if (expense.place) {
    const place = document.createElement('a');
    place.href = osmUrl(expense.place);
    place.textContent = expense.place.name;
    place.title = 'Открыть место на карте OpenStreetMap';
    meta.append(', ', place);
  }
  body.append(title, meta);

  const amount = document.createElement('span');
  amount.className = 'amount';
  amount.textContent = formatMoney(expense.amount);
  item.append(icon, body, amount);

  if (onDelete) {
    item.classList.add('has-actions');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.textContent = '×';
    button.setAttribute('aria-label', `Удалить запись «${expense.title}» на ${formatMoney(expense.amount)}`);
    button.title = 'Удалить запись';
    button.addEventListener('click', () => onDelete(expense, item, button));
    item.append(button);
  }
  return item;
}

/*
 * Удаление записи с подтверждением. Возвращает true, если запись удалена.
 * Ошибку показывает в элементе statusElement.
 */
async function deleteExpense(expense, statusElement) {
  const question = `Удалить запись «${expense.title}» на ${formatMoney(expense.amount)} от ${formatRuDate(expense.spent_on)}?`;
  if (!window.confirm(question)) return false;
  try {
    await api(`/api/expenses/${expense.id}`, { method: 'DELETE' });
    statusElement.className = 'form-status is-success';
    statusElement.textContent = `Запись «${expense.title}» удалена.`;
    return true;
  } catch (error) {
    statusElement.className = 'form-status is-error';
    statusElement.textContent = error.message;
    return false;
  }
}
