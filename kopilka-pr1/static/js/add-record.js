'use strict';

/*
 * Страница «Добавить запись»: проверка формы, пересчёт суммы из другой
 * валюты по курсу ЦБ, поиск места на карте и сохранение записи на сервере
 * (POST /api/expenses). После сохранения список последних записей и итог
 * месяца загружаются с сервера заново — так видно, что запись действительно в базе.
 */

const addForm = document.getElementById('add-form');
const amountField = addForm.elements.amount;
const currencyField = addForm.elements.currency;
const amountHint = document.getElementById('amount-hint');
const addStatus = document.getElementById('add-status');
const MAX_AMOUNT = 1000000;
const RECENT_LIMIT = 5;

// Имена полей на сервере → имена полей формы, чтобы показать ошибку сервера у нужного поля
const SERVER_FIELDS = {
  spent_on: 'date',
  original_amount: 'amount',
  original_currency: 'currency',
  place: 'place_query',
  place_lat: 'place_query',
  place_lon: 'place_query',
};

let currentRates = null; // ответ ЦБ; null — курсы ещё не загружены или не загрузились

/* ---------- правила проверки полей ---------- */

const addRules = {
  amount(value) {
    if (value === '') return 'Введите сумму.';
    const amount = parseAmount(value);
    if (Number.isNaN(amount)) return 'Сумма — это число, например 350 или 12,50.';
    if (amount <= 0) return 'Сумма должна быть больше нуля.';
    if (amount > MAX_AMOUNT) return `Слишком большая сумма: не больше ${MAX_AMOUNT.toLocaleString('ru-RU')}.`;
    if (!/^\d+([.,]\d{1,2})?$/.test(value.replace(/\s/g, ''))) return 'После запятой — не больше двух цифр.';
    return '';
  },
  currency(value) {
    if (value === 'RUB' || (currentRates && currentRates.Valute[value])) return '';
    return 'Курс этой валюты сейчас недоступен — выберите рубли.';
  },
  category(value) {
    return value === '' ? 'Выберите категорию.' : '';
  },
  date(value, field) {
    if (field.validity.badInput) return 'Дата введена не полностью.';
    if (value === '') return 'Укажите дату.';
    if (value > todayIso()) return 'Дата не может быть позже сегодняшней.';
    if (value < field.min) return 'Слишком давняя дата: не раньше 1 января 2020 года.';
    return '';
  },
  title(value) {
    return value.length > 80 ? 'Название — не длиннее 80 символов.' : '';
  },
  note(value) {
    return value.length > 200 ? 'Комментарий — не длиннее 200 символов.' : '';
  },
};

/* ---------- пересчёт из другой валюты ---------- */

/* Сумма в рублях; для рублей возвращает исходную сумму */
function toRubles(amount, currencyCode) {
  if (currencyCode === 'RUB') return amount;
  return amount * rateForOne(currentRates.Valute[currencyCode]);
}

/* Подсказка под суммой: «≈ 1 008 ₽ по курсу ЦБ: 1 USD (доллар США) = 80,68 ₽» */
function updateConversionHint() {
  const code = currencyField.value;
  if (code === 'RUB' || !currentRates) {
    amountHint.hidden = true;
    return;
  }
  const currency = currentRates.Valute[code];
  const rateText = `${currency.Nominal} ${code} (${CURRENCY_NAMES[code]}) = ${formatRate(currency.Value)} ₽`;
  const amount = parseAmount(amountField.value.trim());
  amountHint.textContent = addRules.amount(amountField.value.trim()) === ''
    ? `≈ ${formatMoney(toRubles(amount, code))} по курсу ЦБ: ${rateText}`
    : `Курс ЦБ: ${rateText}`;
  amountHint.hidden = false;
}

/* Заполняет список валют, когда курсы загрузились, или объясняет, почему валют нет */
function handleRates(data) {
  currentRates = data;
  const selected = currencyField.value;
  // при повторной загрузке сначала убираем старые варианты, кроме рублей
  for (const option of [...currencyField.options]) {
    if (option.value !== 'RUB') option.remove();
  }
  if (data) {
    for (const code of Object.keys(CURRENCY_NAMES)) {
      if (data.Valute[code]) {
        currencyField.add(new Option(code, code));
      }
    }
  }
  currencyField.value = [...currencyField.options].some((option) => option.value === selected) ? selected : 'RUB';
  updateConversionHint();
}

/* ---------- последние записи и итог месяца с сервера ---------- */

async function loadRecent(newId = null) {
  const list = document.getElementById('recent-list');
  const data = await api(`/api/expenses?limit=${RECENT_LIMIT}`);
  if (data.items.length === 0) {
    list.replaceChildren(el('li', { className: 'loading' }, 'Записей пока нет — эта будет первой.'));
    return false;
  }
  let found = false;
  list.replaceChildren(...data.items.map((expense) => {
    const item = createExpenseItem(expense);
    if (expense.id === newId) {
      item.classList.add('is-new');
      item.querySelector('.expense-title').append(' ', el('span', { className: 'badge' }, 'новая'));
      found = true;
    }
    return item;
  }));
  return found;
}

/* Итог месяца по категориям; month — «2026-09» или пусто (последний месяц с записями) */
async function loadSummary(month = '', changedSlug = '') {
  const summary = await api(month ? `/api/summary?month=${month}` : '/api/summary');
  const title = document.getElementById('period-title');
  title.replaceChildren(`Итог за ${formatMonth(summary.month)}: `, el('span', {}, formatMoney(summary.total)));
  const rows = summary.categories.filter((row) => row.count > 0);
  const list = document.getElementById('summary-list');
  if (rows.length === 0) {
    list.replaceChildren(el('li', { className: 'loading' }, 'В этом месяце записей пока нет.'));
    return;
  }
  list.replaceChildren(...rows.map((row) => {
    const text = `${formatMoney(row.spent)} из ${formatMoney(row.monthly_limit)}`;
    const item = el('li', {},
      el('a', { href: `category.html?slug=${row.slug}` }, row.name),
      el('meter', {
        min: 0, max: row.monthly_limit, value: Math.min(row.spent, row.monthly_limit),
        low: row.monthly_limit * 0.5, high: row.monthly_limit * 0.8, optimum: 0, title: text,
      }, text),
      el('span', { className: 'amount' }, formatMoney(row.spent)));
    if (row.slug === changedSlug) item.classList.add('is-updated');
    return item;
  }));
}

/* ---------- сохранение записи ---------- */

/* Собирает тело запроса из полей формы */
function readRecord(form) {
  const amount = parseAmount(form.elements.amount.value.trim());
  const currency = form.elements.currency.value;
  const record = {
    amount: Math.round(toRubles(amount, currency)),
    category: form.elements.category.value,
    spent_on: form.elements.date.value,
    title: form.elements.title.value.trim(),
    note: form.elements.note.value.trim(),
  };
  if (currency !== 'RUB') {
    record.original_amount = amount;
    record.original_currency = currency;
  }
  if (chosenPlace) {
    record.place = chosenPlace.name;
    record.place_lat = chosenPlace.lat;
    record.place_lon = chosenPlace.lon;
  }
  return record;
}

async function saveRecord(form) {
  const record = readRecord(form);
  if (record.amount < 1) {
    showFieldError(amountField, 'В рублях это меньше 1 ₽ — такую сумму не записать.');
    amountField.focus();
    return;
  }
  let saved;
  try {
    saved = await api('/api/expenses', { method: 'POST', body: record });
  } catch (error) {
    if (error.status === 401) {
      window.location.replace(loginUrl());
      return;
    }
    showServerErrors(form, error, SERVER_FIELDS);
    setFormStatus(form, `Запись не сохранена. ${error.message}`, 'error');
    return;
  }

  // поля очищаем для следующей записи, дату, валюту и категорию оставляем
  for (const name of ['amount', 'title', 'note']) {
    form.elements[name].value = '';
  }
  form.elements.note.dispatchEvent(new Event('input'));
  clearPlace();
  updateConversionHint();
  amountField.focus();

  let inRecent = false;
  try {
    inRecent = await loadRecent(saved.id);
    await loadSummary(saved.spent_on.slice(0, 7), saved.category.slug);
  } catch {
    // запись уже сохранена; списки обновятся при следующем открытии страницы
  }
  const where = inRecent ? 'Она первая в списке последних.' : 'Дата у неё ранняя, поэтому в пятёрку последних она не попала.';
  setFormStatus(form, `Запись «${saved.title}» на ${formatMoney(saved.amount)} сохранена на сервере. ${where} `
    + `Итог за ${formatMonth(saved.spent_on.slice(0, 7))} пересчитан.`, 'success');
}

/* ---------- запуск ---------- */

async function init() {
  addForm.elements.date.max = todayIso(); // в календаре нельзя выбрать будущую дату
  addForm.elements.date.value = todayIso();
  setupFormValidation(addForm, addRules, saveRecord);
  setupCharCounter(addForm.elements.note, document.getElementById('note-counter'));
  amountField.addEventListener('input', updateConversionHint);
  currencyField.addEventListener('change', updateConversionHint);
  initPlaceSearch();
  initRates(handleRates);

  try {
    await requireUser();
    const categories = await api('/api/categories');
    const select = addForm.elements.category;
    for (const category of categories) {
      select.add(new Option(category.name, category.slug));
    }
    // add.html?category=cafe — категория уже выбрана (ссылка со страницы категории)
    const preset = new URLSearchParams(window.location.search).get('category');
    if (categories.some((category) => category.slug === preset)) select.value = preset;
    await Promise.all([loadRecent(), loadSummary()]);
  } catch (error) {
    setFormStatus(addForm, error.message, 'error');
  }
}

init();
