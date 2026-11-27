'use strict';

/*
 * Страницы «Вход» и «Регистрация».
 * Вход: POST /api/login, регистрация: POST /api/register. Сервер в ответ
 * ставит cookie сессии, и браузер переходит туда, откуда пришёл пользователь
 * (параметр next в адресе), или на главную.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]*$/;

/* Куда вернуться после входа. Разрешены только страницы этого сайта:
   ссылка вида login.html?next=https://чужой-сайт не уведёт пользователя. */
function nextPage() {
  const next = new URLSearchParams(window.location.search).get('next') || '';
  const allowed = /^[a-z0-9-]+\.html(\?[^#]*)?$/.test(next) && !/^(login|register)\.html/.test(next);
  return allowed ? next : 'index.html';
}

function emailRule(value) {
  if (value === '') return 'Введите адрес электронной почты.';
  if (!EMAIL_PATTERN.test(value)) return 'Проверьте адрес: он должен быть вида name@example.com.';
  return '';
}

/* ---------- вход ---------- */

const loginForm = document.getElementById('login-form');

if (loginForm) {
  setupFormValidation(loginForm, {
    email: emailRule,
    password(value) {
      return value === '' ? 'Введите пароль.' : '';
    },
  }, async (form) => {
    try {
      await api('/api/login', {
        method: 'POST',
        body: { email: form.elements.email.value.trim(), password: form.elements.password.value },
      });
      window.location.assign(nextPage());
    } catch (error) {
      if (!showServerErrors(form, error)) form.elements.password.focus();
      setFormStatus(form, error.message, 'error');
      form.elements.password.value = '';
    }
  });

  document.getElementById('demo-fill').addEventListener('click', () => {
    loginForm.elements.email.value = 'demo@example.com';
    loginForm.elements.password.value = 'kopilka-demo';
    loginForm.querySelector('[type="submit"]').focus();
  });
  // ссылка на регистрацию сохраняет адрес возврата
  document.getElementById('register-link').search = window.location.search;
}

/* ---------- регистрация ---------- */

const registerForm = document.getElementById('register-form');

if (registerForm) {
  setupFormValidation(registerForm, {
    name(value) {
      if (value === '') return 'Введите имя.';
      if (value.length < 2) return 'Имя слишком короткое: нужно хотя бы 2 буквы.';
      if (!NAME_PATTERN.test(value)) return 'В имени могут быть только буквы, пробел, дефис и апостроф.';
      return '';
    },
    email: emailRule,
    password(_value, field) {
      const value = field.value; // пробелы — часть пароля, не обрезаем
      if (value === '') return 'Придумайте пароль.';
      if (value.length < 8) return `Пароль слишком короткий: нужно хотя бы 8 символов, сейчас ${value.length}.`;
      if (/^\d+$/.test(value)) return 'Пароль только из цифр легко подобрать: добавьте буквы.';
      return '';
    },
    password2(_value, field) {
      if (field.value === '') return 'Повторите пароль.';
      return field.value === registerForm.elements.password.value ? '' : 'Пароли не совпадают.';
    },
  }, async (form) => {
    try {
      await api('/api/register', {
        method: 'POST',
        body: {
          name: form.elements.name.value.trim(),
          email: form.elements.email.value.trim(),
          password: form.elements.password.value,
        },
      });
      window.location.assign(nextPage() === 'index.html' ? 'add.html' : nextPage());
    } catch (error) {
      showServerErrors(form, error);
      setFormStatus(form, error.message, 'error');
    }
  });
  document.getElementById('login-link').search = window.location.search;
}

/* Уже вошли — форма не нужна */
currentUser.then((user) => {
  if (user) window.location.replace(nextPage() === 'index.html' ? 'profile.html' : nextPage());
}, () => {});
