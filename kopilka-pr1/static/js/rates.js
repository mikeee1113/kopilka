'use strict';

/*
 * Курсы валют ЦБ РФ с сайта cbr-xml-daily.ru.
 * Запрос выполняется асинхронно через fetch. Пока он идёт, в карточке
 * видно сообщение о загрузке. Если сеть отключена или сервер ответил ошибкой,
 * карточка объясняет, что случилось, а остальная страница работает как обычно.
 */

const RATES_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const RATES_TIMEOUT_MS = 8000;

/* Валюты, которые показываем в карточке */
const CARD_CURRENCIES = ['USD', 'EUR', 'CNY'];

/* Названия валют для карточки и списка в форме */
const CURRENCY_NAMES = {
  USD: 'доллар США',
  EUR: 'евро',
  CNY: 'китайский юань',
  TRY: 'турецкая лира',
  KZT: 'казахстанский тенге',
  BYN: 'белорусский рубль',
  AED: 'дирхам ОАЭ',
  THB: 'тайский бат',
  GEL: 'грузинский лари',
  AMD: 'армянский драм',
};

/* Ошибка загрузки курсов с понятным пользователю текстом */
class RatesError extends Error {}

/*
 * Загружает курсы и возвращает объект из ответа сервера:
 * { Date, PreviousDate, Valute: { USD: { Nominal, Value, Previous, … }, … } }.
 * При любой неудаче выбрасывает RatesError с объяснением.
 */
async function fetchRates() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);
  try {
    const response = await fetch(RATES_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new RatesError(`Сервер курсов ответил ошибкой ${response.status}.`);
    }
    const data = await response.json();
    if (!data.Valute || !data.Date) {
      throw new RatesError('Сервер курсов прислал данные в неожиданном виде.');
    }
    return data;
  } catch (error) {
    if (error instanceof RatesError) throw error;
    if (error.name === 'AbortError') {
      throw new RatesError(`Сервер курсов не ответил за ${RATES_TIMEOUT_MS / 1000} секунд.`);
    }
    if (error instanceof SyntaxError) {
      throw new RatesError('Сервер курсов прислал данные в неожиданном виде.');
    }
    // fetch выбрасывает TypeError, когда запрос не дошёл до сервера
    throw new RatesError(navigator.onLine
      ? 'Не удалось связаться с сервером курсов.'
      : 'Нет подключения к интернету.');
  } finally {
    clearTimeout(timer);
  }
}

/* Курс за одну единицу валюты: у некоторых валют ЦБ даёт курс за 10 или 100 единиц */
function rateForOne(currency) {
  return currency.Value / currency.Nominal;
}

/* «2026-10-31T11:30:00+03:00» → «31.10.2026» */
function formatRatesDate(isoDateTime) {
  const [year, month, day] = isoDateTime.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

function showRatesLoading() {
  const card = document.getElementById('rates');
  card.setAttribute('aria-busy', 'true');
  document.getElementById('rates-status').className = 'rates-status is-loading';
  document.getElementById('rates-status').textContent = 'Загружаем курсы с сайта ЦБ…';
  document.getElementById('rates-content').replaceChildren();
  document.getElementById('rates-retry').hidden = true;
}

/* Строит таблицу «валюта — курс — изменение за день» */
function renderRatesTable(data) {
  const table = document.createElement('table');
  table.className = 'rates-table';
  table.innerHTML = '<thead><tr><th scope="col">Валюта</th><th scope="col">Курс, ₽</th>'
    + '<th scope="col">За день</th></tr></thead>';
  const body = document.createElement('tbody');

  for (const code of CARD_CURRENCIES) {
    const currency = data.Valute[code];
    if (!currency) continue;
    const change = (currency.Value - currency.Previous) / currency.Nominal;
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.innerHTML = `<abbr title="${CURRENCY_NAMES[code]}">${code}</abbr>`;
    const value = document.createElement('td');
    value.textContent = formatRate(rateForOne(currency));
    const delta = document.createElement('td');
    if (Number.isNaN(change)) {
      delta.textContent = '—';
    } else if (Math.abs(change) < 0.005) {
      delta.textContent = 'без изменений';
    } else {
      delta.className = change > 0 ? 'rate-up' : 'rate-down';
      delta.textContent = `${change > 0 ? '▲ +' : '▼ −'}${formatRate(Math.abs(change))}`;
    }
    row.append(name, value, delta);
    body.append(row);
  }
  table.append(body);

  const card = document.getElementById('rates');
  card.removeAttribute('aria-busy');
  const status = document.getElementById('rates-status');
  status.className = 'rates-status';
  status.textContent = `Официальный курс на ${formatRatesDate(data.Date)}`;
  document.getElementById('rates-content').replaceChildren(table);
  const button = document.getElementById('rates-retry');
  button.textContent = 'Обновить курсы';
  button.hidden = false;
}

function renderRatesError(message) {
  document.getElementById('rates').removeAttribute('aria-busy');
  const status = document.getElementById('rates-status');
  status.className = 'rates-status is-error';
  status.textContent = `Курсы не загрузились. ${message} Записи в рублях можно добавлять как обычно.`;
  document.getElementById('rates-content').replaceChildren();
  const button = document.getElementById('rates-retry');
  button.textContent = 'Повторить попытку';
  button.hidden = false;
}

/*
 * Загружает курсы и показывает результат в карточке.
 * onResult получает данные или null, если загрузить не удалось.
 */
async function loadRates(onResult) {
  showRatesLoading();
  try {
    const data = await fetchRates();
    renderRatesTable(data);
    onResult(data);
  } catch (error) {
    renderRatesError(error instanceof RatesError ? error.message : 'Неизвестная ошибка.');
    onResult(null);
  }
}

/*
 * Запускает загрузку при открытии страницы, по кнопке под карточкой
 * («Обновить курсы» или «Повторить попытку») и автоматически,
 * когда браузер сообщает, что связь восстановилась после ошибки.
 */
function initRates(onResult) {
  document.getElementById('rates-retry').addEventListener('click', () => loadRates(onResult));
  window.addEventListener('online', () => {
    if (document.getElementById('rates-status').classList.contains('is-error')) {
      loadRates(onResult);
    }
  });
  loadRates(onResult);
}
