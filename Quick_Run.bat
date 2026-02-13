@echo off
REM =======================================
REM Update & Run Ignis-Transcode (Dev Mode)
REM =======================================

echo Pulling latest changes...
git pull origin main

echo Installing client dependencies...
cd client
call npm install

echo Installing server dependencies...
cd ..\server
call npm install

echo Installing root dependencies...
cd ..
call npm install

echo Starting development server...
call npm run dev

echo.
pause
