#!/usr/bin/env bash
# Radar · Fase 2 · instala (ou remove) o worker do PJe como LaunchAgent.
#
#   scripts/radar/install_launchd.sh            # instala e carrega
#   scripts/radar/install_launchd.sh --dry-run  # só mostra o que faria
#   scripts/radar/install_launchd.sh --unload   # descarrega e remove
#
# O plist modelo (scripts/radar/com.fg.radar-pje.plist) tem __RAIZ__ no lugar
# da pasta do repositório; o script troca pelo caminho real e copia para
# ~/Library/LaunchAgents. Log do worker: data/radar/pje_worker.log.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.fg.radar-pje"
MODELO="$RAIZ/scripts/radar/$LABEL.plist"
DESTINO="$HOME/Library/LaunchAgents/$LABEL.plist"
DRY=0
MODO="install"

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY=1 ;;
    --unload|--remove) MODO="unload" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi
}

if [ "$MODO" = "unload" ]; then
  echo "Descarregando $LABEL"
  run launchctl unload "$DESTINO"
  run rm -f "$DESTINO"
  exit 0
fi

[ -f "$MODELO" ] || { echo "modelo não encontrado: $MODELO" >&2; exit 1; }
[ -x "$RAIZ/.venv/bin/python" ] || echo "aviso: $RAIZ/.venv/bin/python não existe; crie a venv antes (README do Radar)" >&2
[ -f "$RAIZ/.env" ] || echo "aviso: $RAIZ/.env não existe; o worker precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY" >&2

echo "Repositório: $RAIZ"
echo "Plist:       $DESTINO"
echo "Comando:     $RAIZ/.venv/bin/python $RAIZ/scripts/radar/pje_worker.py --headless"
echo "Logs:        $RAIZ/data/radar/launchd.out.log e launchd.err.log (worker: data/radar/pje_worker.log)"

run mkdir -p "$RAIZ/data/radar" "$HOME/Library/LaunchAgents"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] sed 's#__RAIZ__#$RAIZ#g' $MODELO > $DESTINO"
else
  sed "s#__RAIZ__#$RAIZ#g" "$MODELO" > "$DESTINO"
fi
# se já estiver carregado, recarrega
if [ "$DRY" = 1 ]; then
  echo "[dry-run] launchctl unload $DESTINO (se já carregado)"
else
  launchctl unload "$DESTINO" 2>/dev/null || true
fi
run launchctl load "$DESTINO"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] launchctl list | grep $LABEL"
else
  launchctl list | grep "$LABEL" || echo "aviso: $LABEL não aparece em launchctl list"
fi
echo "Pronto. Para parar: scripts/radar/install_launchd.sh --unload"
