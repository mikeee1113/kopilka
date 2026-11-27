'use strict';

/*
 * Профиль: данные аккаунта и статистика (GET /api/me),
 * изменение имени и бюджета (PATCH /api/me) и выход (POST /api/logout).
 */

const profileForm = document.getElementById('profile-form');
const NAME_PATTERN = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]*$/;

/* «2026-11-13T10:06:55+00:00» → «13 ноября» */
function formatTimestamp(iso) {
  const local = new Date(iso);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return formatRuDate(`${local.getFullYear()}-${month}-${day}`);
}

function renderProfile(user) {
  document.getElementById('profile-greeting').textContent = `Здравствуйте, ${user.name}! Здесь можно изменить имя и бюджет или выйти из аккаунта.`;
  document.getElementById('profile-name').textContent = user.name;
  document.getElementById('profile-email').textContent = user.email;
  document.getElementById('profile-created').textContent = formatTimestamp(user.created_at);
  profileForm.elements.name.value = user.name;
  profileForm.elements.monthly_budget.value = user.monthly_budget.toLocaleString('ru-RU');
  if (user.stats) {
    const { count, total, first_date: first, last_date: last } = user.stats;
    document.getElementById('stat-count').textContent = String(count);
    document.getElementById('stat-total').textContent = formatMoney(total);
    document.getElementById('stat-period').textContent = count
      ? `Записи с ${formatRuDate(first)} по ${formatRuDate(last)}.`
      : 'Записей пока нет.';
  }
}

const profileRules = {
  name(value) {
    if (value === '') return 'Введите имя.';
    if (value.length < 2) return 'Имя слишком короткое: нужно хотя бы 2 буквы.';
    if (!NAME_PATTERN.test(value)) return 'В имени могут быть только буквы, пробел, дефис и апостроф.';
    return '';
  },
  monthly_budget(value) {
    if (value === '') return 'Укажите бюджет.';
    const budget = parseAmount(value);
    if (Number.isNaN(budget) || !Number.isInteger(budget)) return 'Бюджет — целое число рублей, например 65 500.';
    if (budget < 1000 || budget > 10000000) return 'Бюджет — от 1 000 до 10 000 000 ₽.';
    return '';
  },
};

async function saveProfile(form) {
  try {
    const user = await api('/api/me', {
      method: 'PATCH',
      body: {
        name: form.elements.name.value.trim(),
        monthly_budget: parseAmount(form.elements.monthly_budget.value.trim()),
      },
    });
    renderProfile({ ...user, stats: null });
    updateAccountLink(user);
    setFormStatus(form, 'Изменения сохранены.', 'success');
  } catch (error) {
    if (error.status === 401) {
      window.location.replace(loginUrl());
      return;
    }
    showServerErrors(form, error);
    setFormStatus(form, error.message, 'error');
  }
}

async function logout() {
  const button = document.getElementById('logout-button');
  button.disabled = true;
  try {
    await api('/api/logout', { method: 'POST' });
    window.location.assign('index.html');
  } catch (error) {
    const status = document.getElementById('logout-status');
    status.className = 'form-status is-error';
    status.textContent = error.message;
    button.disabled = false;
  }
}

async function init() {
  setupFormValidation(profileForm, profileRules, saveProfile);
  document.getElementById('logout-button').addEventListener('click', logout);
  try {
    await requireUser();
    renderProfile(await api('/api/me')); // профиль вместе со статистикой записей
  } catch (error) {
    document.getElementById('profile-greeting').textContent = error.message;
  }
}

init();
