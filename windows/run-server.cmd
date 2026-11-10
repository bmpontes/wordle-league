@echo off
rem Arranca o servidor da Forense Wordle League (usado pela tarefa agendada do Windows).
rem O registo fica em data\logs\server.log (rodado quando passa de 10 MB, a cada arranque).
cd /d "%~dp0.."

set "NODE_EXE=node"
if exist "%~dp0node-path.txt" set /p NODE_EXE=<"%~dp0node-path.txt"

if not exist "data\logs" mkdir "data\logs"
if exist "data\logs\server.log" (
  for %%F in ("data\logs\server.log") do if %%~zF GTR 10485760 move /y "data\logs\server.log" "data\logs\server.old.log" >nul
)

echo [%date% %time%] A iniciar >> "data\logs\server.log"
"%NODE_EXE%" --env-file-if-exists=.env src\server.js >> "data\logs\server.log" 2>&1
exit /b %ERRORLEVEL%
