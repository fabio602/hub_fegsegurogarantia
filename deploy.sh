#!/bin/bash

# Garante execução a partir da raiz do projeto
cd "$(dirname "$0")"

echo "== Deploy automatico =="
echo ""

echo "[1/3] git add ."
git add .
if [ $? -ne 0 ]; then
  echo ""
  echo "ERRO: falha no git add."
  exit 1
fi

echo "[2/3] git commit"
if git diff --cached --quiet; then
  echo "Nada para commitar."
else
  git commit -m "Deploy automatico"
  if [ $? -ne 0 ]; then
    echo ""
    echo "ERRO: falha no git commit."
    exit 1
  fi
fi

echo "[3/3] git push"
git push
if [ $? -ne 0 ]; then
  echo ""
  echo "ERRO: falha no git push."
  exit 1
fi

echo ""
echo "Deploy concluido com sucesso."
