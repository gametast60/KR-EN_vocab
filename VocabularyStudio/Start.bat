@echo off
cd /d "%~dp0"
py -3 -c "import tkinter, PIL" >nul 2>nul
if not errorlevel 1 (
    py -3 app\vocab_studio.py
    if errorlevel 1 pause
    exit /b
)
set "VOCAB_PY="
for /d %%D in ("%LocalAppData%\Programs\Python\Python*") do if exist "%%D\python.exe" set "VOCAB_PY=%%D\python.exe"
if defined VOCAB_PY (
    "%VOCAB_PY%" app\vocab_studio.py
    if errorlevel 1 pause
    exit /b
)
python app\vocab_studio.py
if errorlevel 1 pause
