'use strict';

/*
 * Страница категории: одна страница для всех двенадцати категорий.
 * Какую показать, задаёт адрес: category.html?slug=groceries.
 * Описание и лимит категории видны всем, а свои траты и записи — только после входа.
 */

const slug = new URLSearchParams(window.location.search).get('slug') || '';
const factsBody = document.getElementById('facts-body');
const recordsList = document.getElementById('records-list');
const recordsStatus = document.getElementById('records-status');
const RECORDS_LIMIT = 20;

function statTile(label, value, className = '') {
  return el('div', {}, el('dt', {}, label), el('dd', className ? { className } : {}, value));
}

function renderCategory(category) {
  document.title = `${category.name} — Копилка`;
  document.getElementById('crumb-name').textContent = category.name;
  document.getElementById('category-name').textContent = category.name;
  document.getElementById('category-description').textContent = category.description;
  const icon = document.getElementById('category-icon');
  icon.src = category.icon;
  icon.alt = category.icon_alt;
  document.getElementById('all-records-link').href = `expenses.html?category=${category.slug}`;
  document.getElementById('add-link').href = `add.html?category=${category.slug}`;
}

/* Гость видит лимит и тип расходов, а вместо своих трат — приглашение войти */
function renderGuest(category) {
  document.getElementById('facts-title').textContent = 'О категории';
  factsBody.replaceChildren(el('dl', { className: 'stats' },
    statTile('Лимит на месяц', formatMoney(category.monthly_limit)),
    statTile('Тип расходов', category.essential ? 'обязательные' : 'необязательные', 'word')));
  document.getElementById('records-body').replaceChildren(
    el('p', {}, 'Записи видны только их владельцу. ',
      el('a', { href: loginUrl() }, 'Войдите'), ', чтобы увидеть свои траты в этой категории.'));
  document.getElementById('all-records-link').hidden = true;
}

/* Цифры за месяц: потрачено, лимит, записи, средний чек, тип */
function renderFacts(category, summary) {
  const row = summary.categories.find((item) => item.slug === category.slug) || { spent: 0, count: 0 };
  document.getElementById('facts-title').textContent = `${capitalize(formatMonth(summary.month))} в цифрах`;
  const limit = category.monthly_limit;
  const label = row.spent > limit
    ? `Лимит превышен на ${formatMoney(row.spent - limit)}`
    : `Использовано ${Math.round((row.spent / limit) * 100)}% лимита`;
  factsBody.replaceChildren(
    el('dl', { className: 'stats' },
      statTile('Потрачено', formatMoney(row.spent), 'key-figure'),
      statTile('Лимит на месяц', formatMoney(limit)),
      statTile('Записей', String(row.count)),
      statTile('Средний чек', row.count ? formatMoney(row.spent / row.count) : '—'),
      statTile('Тип расходов', category.essential ? 'обязательные' : 'необязательные', 'word')),
    el('p', { className: 'meter-line' },
      el('label', { htmlFor: 'limit-meter' }, label),
      el('meter', {
        id: 'limit-meter', min: 0, max: limit, value: Math.min(row.spent, limit),
        low: limit * 0.5, high: limit * 0.8, optimum: 0,
      }, `${formatMoney(row.spent)} из ${formatMoney(limit)}`)),
  );
}

async function removeRecord(expense, item) {
  if (await deleteExpense(expense, recordsStatus)) {
    item.remove();
    loadUserData(); // цифры месяца пересчитываются на сервере
  }
}

function renderRecords(data) {
  if (data.items.length === 0) {
    recordsList.replaceChildren(el('li', { className: 'empty-state' }, 'В этой категории пока нет записей.'));
    return;
  }
  recordsList.replaceChildren(...data.items.map((expense) => createExpenseItem(expense, {
    showCategory: false,
    onDelete: removeRecord,
  })));
  if (data.count > data.items.length) {
    recordsList.append(el('li', { className: 'loading' },
      `Показаны последние ${data.items.length} из ${data.count}. Остальные — в списке расходов.`));
  }
}

let currentCategory = null;

async function loadUserData() {
  const [summary, records] = await Promise.all([
    api('/api/summary'),
    api(`/api/expenses?category=${encodeURIComponent(slug)}&limit=${RECORDS_LIMIT}`),
  ]);
  renderFacts(currentCategory, summary);
  renderRecords(records);
}

/* Неизвестная категория: вместо статьи — сообщение и ссылки */
function renderNotFound() {
  document.title = 'Категория не найдена — Копилка';
  document.getElementById('crumb-name').textContent = 'Категория не найдена';
  document.getElementById('category-article').replaceChildren(
    el('section', { className: 'not-found' },
      el('p', { className: 'error-code' }, '404'),
      el('h1', {}, 'Такой категории нет'),
      el('p', { className: 'lead' }, 'Возможно, ссылка устарела или в адресе опечатка. Выберите категорию из списка.'),
      el('p', { className: 'actions' },
        el('a', { className: 'button', href: 'index.html' }, 'На главную'),
        el('a', { className: 'button button-secondary', href: 'expenses.html' }, 'К списку расходов'))));
}

async function init() {
  try {
    currentCategory = await api(`/api/categories/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error.status === 404) {
      renderNotFound();
    } else {
      showNotice(factsBody, error.message, { isError: true });
    }
    return;
  }
  renderCategory(currentCategory);
  try {
    const user = await currentUser;
    if (user) {
      await loadUserData();
    } else {
      renderGuest(currentCategory);
    }
  } catch (error) {
    showNotice(factsBody, error.message, { isError: true });
  }
}

init();
