'use strict';

/*
 * Страница «Расходы»: записи текущего пользователя с сервера.
 * Условия фильтра (категория, период, текст) и сортировка уходят на сервер
 * в адресе запроса: GET /api/expenses?category=cafe&sort=amount-desc…
 * Сервер возвращает только подходящие записи, их количество и сумму.
 * Условия сохраняются в адресе страницы, поэтому после обновления и по ссылке
 * открывается тот же отбор.
 */

const PAGE_SIZE = 20;
const filterForm = document.getElementById('filter-form');
const expenseList = document.getElementById('expense-list');
const resultLine = document.getElementById('filter-result');
const listStatus = document.getElementById('list-status');
const FILTER_FIELDS = ['category', 'date_from', 'date_to', 'q', 'sort'];

let found = { count: 0, total: 0 }; // сколько записей подходит и на какую сумму
let requestNumber = 0;              // ответы на устаревшие запросы не показываем

/* Условия из формы; пустые поля и сортировку по умолчанию не передаём */
function filterParams() {
  const params = new URLSearchParams();
  for (const name of FILTER_FIELDS) {
    const value = filterForm.elements[name].value.trim();
    if (value !== '' && !(name === 'sort' && value === 'date-desc')) params.set(name, value);
  }
  return params;
}

/* Начало периода не может быть позже конца — иначе фильтр ничего не покажет */
function validatePeriod() {
  const fields = filterForm.elements;
  clearFieldError(fields.date_from);
  clearFieldError(fields.date_to);
  if (fields.date_from.validity.badInput) {
    showFieldError(fields.date_from, 'Дата введена не полностью.');
    return false;
  }
  if (fields.date_to.validity.badInput) {
    showFieldError(fields.date_to, 'Дата введена не полностью.');
    return false;
  }
  if (fields.date_from.value && fields.date_to.value && fields.date_from.value > fields.date_to.value) {
    showFieldError(fields.date_to, 'Конец периода раньше начала. Выберите дату не раньше той, что в поле «С даты».');
    return false;
  }
  return true;
}

/* Строка над списком и итог под ним */
function showResult() {
  const filtered = [...filterParams().keys()].some((name) => name !== 'sort');
  const words = ['запись', 'записи', 'записей'];
  const { count, total } = found;
  if (count === 0) {
    resultLine.textContent = filtered ? 'Ничего не найдено.' : 'Записей пока нет — добавьте первую.';
  } else {
    resultLine.textContent = filtered
      ? `Найдено ${count} ${pluralize(count, words)} на сумму ${formatMoney(total)}.`
      : `Всего ${count} ${pluralize(count, words)} на сумму ${formatMoney(total)}.`;
  }
  document.getElementById('empty-state').hidden = count > 0 || !filtered;
  document.getElementById('total-line').hidden = count === 0;
  document.getElementById('total-label').textContent = filtered ? 'Итого по выбранным' : 'Итого';
  document.getElementById('total-amount').textContent = formatMoney(total);
  document.getElementById('more-line').hidden = expenseList.children.length >= count;
}

async function removeItem(expense, item) {
  if (await deleteExpense(expense, listStatus)) {
    item.remove();
    found = { count: found.count - 1, total: found.total - expense.amount };
    showResult();
  }
}

/* Загружает записи. more = true — следующая порция добавляется к уже показанным */
async function loadExpenses(more = false) {
  if (!validatePeriod()) return;
  const params = filterParams();
  if (!more) {
    // адрес страницы повторяет условия фильтра
    const query = params.toString();
    history.replaceState(null, '', query ? `expenses.html?${query}` : 'expenses.html');
  }
  params.set('limit', PAGE_SIZE);
  params.set('offset', more ? expenseList.children.length : 0);

  const number = ++requestNumber;
  expenseList.setAttribute('aria-busy', 'true');
  listStatus.textContent = '';
  try {
    const data = await api(`/api/expenses?${params}`);
    if (number !== requestNumber) return;
    found = { count: data.count, total: data.total };
    const items = data.items.map((expense) => createExpenseItem(expense, { onDelete: removeItem }));
    if (more) {
      expenseList.append(...items);
    } else {
      expenseList.replaceChildren(...items);
    }
    showResult();
  } catch (error) {
    if (error.status === 401) {
      window.location.replace(loginUrl());
      return;
    }
    if (number !== requestNumber) return;
    if (!showServerErrors(filterForm, error, { date_from: 'date_from', date_to: 'date_to' })) {
      resultLine.textContent = error.message;
    }
  } finally {
    expenseList.removeAttribute('aria-busy');
  }
}

/* Список категорий для фильтра и «таблеток» */
function renderCategories(categories) {
  const select = filterForm.elements.category;
  for (const category of categories) {
    select.add(new Option(category.name, category.slug));
  }
  document.getElementById('category-chips').replaceChildren(...categories.map((category) => el('li', {},
    el('a', { className: 'chip', href: `category.html?slug=${category.slug}` },
      el('img', { src: category.icon, alt: category.icon_alt, width: 24, height: 24 }),
      category.name))));
}

/* Поля фильтра из адреса страницы: expenses.html?category=cafe → выбрана категория «Кафе» */
function fillFormFromAddress() {
  const params = new URLSearchParams(window.location.search);
  for (const name of FILTER_FIELDS) {
    const field = filterForm.elements[name];
    const value = params.get(name);
    if (value === null) continue;
    if (field.tagName === 'SELECT' && ![...field.options].some((option) => option.value === value)) continue;
    field.value = value;
  }
}

async function init() {
  try {
    await requireUser();
    renderCategories(await api('/api/categories'));
  } catch (error) {
    resultLine.textContent = error.message;
    return;
  }
  fillFormFromAddress();
  filterForm.addEventListener('change', () => loadExpenses());
  filterForm.addEventListener('submit', (event) => {
    event.preventDefault(); // фильтр работает без перезагрузки страницы
    loadExpenses();
  });
  // событие reset приходит до того, как поля вернулись к начальным значениям
  filterForm.addEventListener('reset', () => setTimeout(() => loadExpenses()));
  document.getElementById('more-button').addEventListener('click', () => loadExpenses(true));
  loadExpenses();
}

init();
