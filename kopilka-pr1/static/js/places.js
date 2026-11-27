'use strict';

/*
 * Поиск места траты на карте OpenStreetMap.
 * Браузер обращается к нашему серверу: GET /api/places?q=…, а сервер — к геокодеру
 * Nominatim. Так соблюдаются правила Nominatim: не чаще запроса в секунду,
 * с названием приложения в заголовке и с запоминанием ответов.
 * Поиск запускается только кнопкой «Найти» (или клавишей Enter в поле),
 * а не при каждой набранной букве, — это тоже требование сервиса.
 */

const placeInput = document.getElementById('place-query');
const placeButton = document.getElementById('place-search');
const placeHint = document.getElementById('place-hint');
const placeResults = document.getElementById('place-results');
const placeOptions = document.getElementById('place-options');
const placeChosen = document.getElementById('place-chosen');
const PLACE_HINT = 'Введите название или адрес и нажмите «Найти».';

let chosenPlace = null; // { name, address, lat, lon } или null, если место не выбрано

function choosePlace(place) {
  chosenPlace = place;
  placeResults.hidden = true;
  placeInput.value = place.name;
  const link = document.getElementById('place-chosen-link');
  link.href = osmUrl(place);
  link.textContent = place.name;
  link.title = place.address;
  placeChosen.hidden = false;
  placeHint.textContent = place.address;
}

function clearPlace() {
  chosenPlace = null;
  placeChosen.hidden = true;
  placeResults.hidden = true;
  placeInput.value = '';
  placeHint.textContent = PLACE_HINT;
  clearFieldError(placeInput);
}

/* Варианты — переключатели: выбор одним щелчком или стрелками на клавиатуре */
function renderPlaceResults(results) {
  if (results.length === 0) {
    placeResults.hidden = true;
    placeHint.textContent = 'Ничего не нашлось. Попробуйте иначе: название и город, например «Эрмитаж, Санкт-Петербург».';
    return;
  }
  placeOptions.replaceChildren(...results.map((place, index) => {
    const radio = el('input', { type: 'radio', name: 'place_choice', value: String(index) });
    radio.addEventListener('change', () => choosePlace(place));
    return el('label', { className: 'place-option' }, radio,
      el('span', {}, place.name, el('small', {}, place.address)));
  }));
  placeResults.hidden = false;
  placeHint.textContent = `Найдено вариантов: ${results.length}. Выберите один из списка.`;
}

async function searchPlaces() {
  const query = placeInput.value.trim();
  clearFieldError(placeInput);
  if (query.length < 3) {
    showFieldError(placeInput, 'Введите хотя бы 3 символа: название места или адрес.');
    placeInput.focus();
    return;
  }
  chosenPlace = null;
  placeChosen.hidden = true;
  placeButton.disabled = true;
  placeHint.textContent = 'Ищем на карте OpenStreetMap…';
  try {
    const data = await api(`/api/places?q=${encodeURIComponent(query)}`);
    renderPlaceResults(data.results);
  } catch (error) {
    placeResults.hidden = true;
    placeHint.textContent = PLACE_HINT;
    showFieldError(placeInput, `Поиск места не удался. ${error.message} Запись можно сохранить и без места.`);
  } finally {
    placeButton.disabled = false;
  }
}

function initPlaceSearch() {
  placeButton.addEventListener('click', searchPlaces);
  // Enter в поле поиска ищет место, а не отправляет всю форму
  placeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchPlaces();
    }
  });
  // текст изменили после выбора — выбранное место больше не совпадает с полем
  placeInput.addEventListener('input', () => {
    if (chosenPlace && placeInput.value.trim() !== chosenPlace.name) {
      chosenPlace = null;
      placeChosen.hidden = true;
      placeHint.textContent = PLACE_HINT;
    }
  });
  document.getElementById('place-clear').addEventListener('click', () => {
    clearPlace();
    placeInput.focus();
  });
}
