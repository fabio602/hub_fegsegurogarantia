@echo off
setlocal

REM Garante execução a partir da raiz do projeto (duplo clique)
cd /d "%~dp0"

echo == Deploy automatico ==
echo.

echo [1/3] git add .
git add .
if errorlevel 1 goto :error

echo [2/3] git commit -m "Deploy automatico"
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Deploy automático"
  if errorlevel 1 goto :error
) else (
  echo Nada para commitar.
)

echo [3/3] git push
git push
if errorlevel 1 goto :error

echo.
echo Deploy concluido com sucesso.
goto :end

:error
echo.
echo ERRO: falha ao executar o deploy.

:end
echo.
pause

