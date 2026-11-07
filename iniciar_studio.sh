#!/usr/bin/env bash
# ==============================================================================
# Lanzador de GraphStudio Enterprise (Recluta 22: ag-graph-visualizer-22)
# ==============================================================================

PORT=8090
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🌐 Iniciando GraphStudio Enterprise en el puerto $PORT..."
cd "$DIR"

# Verificar si el puerto está en uso
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️ El puerto $PORT ya está en uso. Matando proceso previo o usando alternativo..."
    fuser -k $PORT/tcp 2>/dev/null
    sleep 1
fi

echo "🚀 Servidor web listo en http://localhost:$PORT"
echo "   - Dataset: Tablas de Multiplicar (0 al 9)"
echo "   - Seguridad: Bóveda Zero-Knowledge (AES-256-GCM)"
echo "Presiona Ctrl+C para detener el servidor."

# Abrir en navegador si existe display
if [ -n "$DISPLAY" ]; then
    xdg-open "http://localhost:$PORT" 2>/dev/null &
fi

python3 -m http.server $PORT
