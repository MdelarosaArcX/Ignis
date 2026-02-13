@echo off
setlocal

REM === Auto-detect base folder ===
set "BASE=%~dp0server"
if "%BASE:~-1%"=="\" set "BASE=%BASE:~0,-1%"

echo =========================================
echo Cleaning server folders...
echo Base path: %BASE%
echo =========================================

REM === Temporary empty folder for robocopy cleanup ===
set "EMPTY=%TEMP%\empty_dir"
if not exist "%EMPTY%" mkdir "%EMPTY%"

REM === List of target folders ===
call :Clean "%BASE%\transcoded\input"
call :Clean "%BASE%\transcoded\output"
call :Clean "%BASE%\uploads"

call :Clean "%BASE%\hotfolder\Channel_01\AXN\Failed"
call :Clean "%BASE%\hotfolder\Channel_01\AXN\Input"
call :Clean "%BASE%\hotfolder\Channel_01\AXN\Completed"

call :Clean "%BASE%\hotfolder\Channel_02\BBC\Failed"
call :Clean "%BASE%\hotfolder\Channel_02\BBC\Input"
call :Clean "%BASE%\hotfolder\Channel_02\BBC\Completed"

call :Clean "%BASE%\hotfolder\Channel_03\Luxe\Failed"
call :Clean "%BASE%\hotfolder\Channel_03\Luxe\Input"
call :Clean "%BASE%\hotfolder\Channel_03\Luxe\Completed"

REM === Reset JSON file ===
set "JSON_FILE=%BASE%\files.json"
if exist "%JSON_FILE%" (
    echo {} > "%JSON_FILE%"
    echo Reset JSON file: %JSON_FILE%
) else (
    echo JSON file not found: %JSON_FILE%
)

REM === Remove temp empty folder ===
rd /s /q "%EMPTY%" >nul 2>&1

echo.
echo =========================================
echo All target folders have been cleaned.
echo =========================================
pause
exit /b

REM === Function: Clean using robocopy ===
:Clean
set "FOLDER=%~1"
if not exist "%FOLDER%" (
    echo Folder not found: %FOLDER%
    goto :eof
)

echo.
echo Cleaning: %FOLDER%

REM Check if folder has content
dir /b "%FOLDER%" >nul 2>&1
if errorlevel 1 (
    echo Nothing to delete in: %FOLDER%
    goto :eof
)

REM Use robocopy mirror to empty folder
robocopy "%EMPTY%" "%FOLDER%" /MIR >nul 2>&1

echo Done: %FOLDER%
goto :eof
