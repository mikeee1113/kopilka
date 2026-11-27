'use strict';

/*
 * Главная страница. Категории приходят с сервера всем посетителям.
 * Вошедший пользователь видит ещё и сводку за месяц: сколько потрачено,
 * сколько записей, какая часть бюджета использована и сколько ушло на каждую категорию.
 */

const summaryTitle = document.getElementById('summary-title');
const summaryBody = document.getElementById('summary-body');
const monthField = document.getElementById('month-field');
const monthSelect = document.getElementById('month');
const categoryGrid = document.getElementById('category-grid');

/* Сводка для гостя: что даёт вход */
function renderGuest() {
  summaryTitle.textContent = 'Ваш месяц';
  summaryBody.replaceChildren(
    el('p', {}, 'Войдите, чтобы увидеть свои траты за месяц: итог, остаток бюджета и суммы по категориям. '
      + 'Каждый пользователь видит только свои записи.'),
    el('p', { className: 'actions' },
      el('a', { className: 'button', href: 'login.html' }, 'Войти'),
      el('a', { className: 'button button-secondary', href: 'register.html' }, 'Зарегистрироваться')),
  );
  document.getElementById('hero-actions').replaceChildren(
    el('a', { className: 'button', href: 'register.html' }, 'Начать вести учёт'),
    el('a', { className: 'button button-secondary', href: 'login.html' }, 'Войти'),
  );
}

/* Плитка с числом: <div><dt>Потрачено</dt><dd>46 960 ₽</dd></div> */
function statTile(label, value, className = '') {
  return el('div', {}, el('dt', {}, label), el('dd', className ? { className } : {}, value));
}

/* Шкала бюджета и подпись к ней */
function budgetMeter(summary) {
  const percent = Math.round((summary.total / summary.budget) * 100);
  const label = summary.left >= 0
    ? `Использовано ${percent}% бюджета`
    : `Бюджет превышен на ${formatMoney(-summary.left)}`;
  return el('p', { className: 'meter-line' },
    el('label', { htmlFor: 'budget-meter' }, label),
    el('meter', {
      id: 'budget-meter',
      min: 0,
      max: summary.budget,
      value: Math.min(summary.total, summary.budget),
      low: summary.budget * 0.5,
      high: summary.budget * 0.8,
      optimum: 0,
    }, `${formatMoney(summary.total)} из ${formatMoney(summary.budget)}`));
}

function renderSummary(summary) {
  summaryTitle.textContent = capitalize(formatMonth(summary.month));
  const [year, month] = summary.month.split('-');
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  const monthLink = `expenses.html?date_from=${summary.month}-01&date_to=${summary.month}-${lastDay}`;
  summaryBody.replaceChildren(
    el('dl', { className: 'stats' },
      statTile('Потрачено', formatMoney(summary.total), 'key-figure'),
      statTile('Записей', String(summary.count)),
      statTile('Бюджет на месяц', formatMoney(summary.budget)),
      statTile(summary.left >= 0 ? 'Осталось' : 'Перерасход', formatMoney(Math.abs(summary.left)))),
    budgetMeter(summary),
    el('p', { className: 'more-line' }, el('a', { href: monthLink }, `Все записи за ${formatMonth(summary.month)}`)),
  );

  // список месяцев, если записи есть больше чем в одном
  if (summary.months.length > 1) {
    monthSelect.replaceChildren(...summary.months.map((value) => new Option(capitalize(formatMonth(value)), value)));
    monthSelect.value = summary.month;
    monthField.hidden = false;
  }
}

/* Плитки категорий. spentBySlug — суммы за месяц (только для вошедшего) */
function renderCategories(categories, summary) {
  const spentBySlug = new Map((summary ? summary.categories : []).map((row) => [row.slug, row.spent]));
  categoryGrid.replaceChildren(...categories.map((category) => {
    const spent = spentBySlug.get(category.slug);
    const line = summary
      ? `${formatMoney(spent || 0)} из ${formatMoney(category.monthly_limit)}`
      : `Лимит ${formatMoney(category.monthly_limit)} в месяц`;
    const card = el('a', { className: 'category-card', href: `category.html?slug=${category.slug}` },
      el('img', { src: category.icon, alt: category.icon_alt, width: 64, height: 64 }),
      el('span', { className: 'category-name' }, category.name),
      el('span', { className: 'category-spent' }, line));
    if (summary && spent > category.monthly_limit) {
      card.append(el('span', { className: 'category-over' }, `лимит превышен на ${formatMoney(spent - category.monthly_limit)}`));
    }
    return el('li', {}, card);
  }));
}

async function loadPage(month = '') {
  try {
    const [user, categories] = await Promise.all([currentUser, api('/api/categories')]);
    if (!user) {
      renderGuest();
      renderCategories(categories, null);
      return;
    }
    const summary = await api(month ? `/api/summary?month=${month}` : '/api/summary');
    renderSummary(summary);
    renderCategories(categories, summary);
  } catch (error) {
    showNotice(summaryBody, error.message, { isError: true });
    categoryGrid.replaceChildren();
  }
}

monthSelect.addEventListener('change', () => loadPage(monthSelect.value));
loadPage();
