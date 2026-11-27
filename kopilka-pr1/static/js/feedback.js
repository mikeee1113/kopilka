'use strict';

/*
 * Страница «Контакты»: проверка формы обратной связи и отправка на сервер
 * (POST /api/feedback). Сообщение сохраняется в таблице feedback базы данных.
 * Если пользователь вошёл, имя и почта уже подставлены.
 */

const feedbackForm = document.getElementById('feedback-form');
const feedbackResult = document.getElementById('feedback-result');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]*$/;
const MESSAGE_MIN_LENGTH = 10;

const feedbackRules = {
  name(value) {
    if (value === '') return 'Введите имя.';
    if (value.length < 2) return 'Имя слишком короткое: нужно хотя бы 2 буквы.';
    if (!NAME_PATTERN.test(value)) return 'В имени могут быть только буквы, пробел, дефис и апостроф.';
    return '';
  },
  email(value) {
    if (value === '') return 'Введите адрес электронной почты.';
    if (!EMAIL_PATTERN.test(value)) return 'Проверьте адрес: он должен быть вида name@example.com.';
    return '';
  },
  message(value) {
    if (value === '') return 'Напишите сообщение.';
    if (value.length < MESSAGE_MIN_LENGTH) {
      return `Слишком коротко: нужно хотя бы ${MESSAGE_MIN_LENGTH} символов, сейчас ${value.length}.`;
    }
    return '';
  },
};

/* Прячет форму и показывает, что сохранено на сервере */
function showFeedbackResult(form, saved) {
  const fields = form.elements;
  const length = fields.message.value.trim().length;
  document.getElementById('result-name').textContent = fields.name.value.trim();
  document.getElementById('result-id').textContent = saved.id;
  document.getElementById('result-email').textContent = fields.email.value.trim();
  document.getElementById('result-topic').textContent = fields.topic.selectedOptions[0].textContent;
  document.getElementById('result-length').textContent = `${length} ${pluralize(length, ['символ', 'символа', 'символов'])}`;
  form.hidden = true;
  feedbackResult.hidden = false;
  feedbackResult.focus(); // программа экранного чтения сразу прочитает результат
}

async function sendFeedback(form) {
  const fields = form.elements;
  try {
    const saved = await api('/api/feedback', {
      method: 'POST',
      body: {
        name: fields.name.value.trim(),
        email: fields.email.value.trim(),
        topic: fields.topic.value,
        message: fields.message.value.trim(),
      },
    });
    showFeedbackResult(form, saved);
  } catch (error) {
    showServerErrors(form, error);
    setFormStatus(form, `Сообщение не отправлено. ${error.message}`, 'error');
  }
}

/* Кнопка «Написать ещё одно сообщение»: форма снова на месте, имя и почта остаются */
function showFeedbackFormAgain() {
  feedbackForm.elements.message.value = '';
  feedbackForm.elements.message.dispatchEvent(new Event('input'));
  feedbackForm.elements.topic.selectedIndex = 0;
  feedbackResult.hidden = true;
  feedbackForm.hidden = false;
  feedbackForm.elements.message.focus();
}

setupFormValidation(feedbackForm, feedbackRules, sendFeedback);
setupCharCounter(feedbackForm.elements.message, document.getElementById('message-counter'));
document.getElementById('feedback-again').addEventListener('click', showFeedbackFormAgain);

currentUser.then((user) => {
  if (!user) return;
  for (const name of ['name', 'email']) {
    if (feedbackForm.elements[name].value === '') feedbackForm.elements[name].value = user[name];
  }
}, () => {});
