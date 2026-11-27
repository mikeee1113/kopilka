@echo off
chcp 65001 > nul
cd /d "%~dp0"
if not exist .venv (
  echo Создаю виртуальное окружение .venv ...
  py -3 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat
echo Устанавливаю зависимости ...
python -m pip install -q -r requirements.txt
echo.
echo Сайт: http://127.0.0.1:8000   Описание API: http://127.0.0.1:8000/docs
echo Демо-вход: demo@example.com / kopilka-demo   Остановить сервер: Ctrl+C
echo.
python -m uvicorn app.main:app --reload
pause
