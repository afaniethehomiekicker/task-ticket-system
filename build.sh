






set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

APP_NAME="apex-core"
WITH_TLS=1

step() { printf "\n\e[1;36m==> %s\e[0m\n" "$1"; }

show_help() {
  sed -n '1,24p' "$0" | sed 's/^# \{0,1\}//' 
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --http) WITH_TLS=0 ;;
    --help|-h) show_help ;;
    *) echo "Unknown argument: $arg (try --help)"; exit 1 ;;
  esac
done

step "[1/3] Bundling the web interface (frontend)"
if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies (first run)..."
  (cd frontend && npm install --no-audit --no-fund)
fi
(cd frontend && npm run build)

step "[2/3] TLS certificates"
if [ "$WITH_TLS" = "1" ]; then
  mkdir -p tls
  CERT="tls/cert.pem"
  KEY="tls/key.pem"
  if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "Reusing existing certificates: $CERT / $KEY"
  else
    if ! command -v openssl >/dev/null 2>&1; then
      echo "ERROR: openssl is not installed and no $CERT/$KEY exist." >&2
      echo "       Install openssl, place your real certificates, or re-run with --http." >&2
      exit 1
    fi
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 \
      -nodes -keyout "$KEY" -out "$CERT" -subj "/CN=apex-core.local/O=APEX CORE" \
      >/dev/null 2>&1
    echo "Generated self-signed certificates (for testing):"
    echo "  $CERT"
    echo "  $KEY"
    echo "NOTE: self-signed certs are not trusted by browsers. For real HTTPS,"
    echo "      replace them with certs from a public CA (e.g. Let's Encrypt)."
  fi
else
  echo "Plain HTTP build requested — no TLS artifacts created."
fi

step "[3/3] Compiling the single binary"
mkdir -p bin
VERSION="$(date +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
# CGO_ENABLED=0 produces a fully static binary that runs on any matching
# platform without shared libraries. -trimpath strips local build paths;
# -ldflags "-s -w" strips symbol/debug tables for a smaller artifact.
CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -X 'main.buildVersion=${VERSION}'" \
  -o "bin/${APP_NAME}" .

echo
echo "============================================================"
echo "  APEX CORE build complete  (version: $VERSION)"
echo "  single binary : $ROOT/bin/$APP_NAME"
[ "$WITH_TLS" = "1" ] && echo "  TLS key/cert  : $ROOT/tls/key.pem / $ROOT/tls/cert.pem"
echo "============================================================"
echo
echo "  PRODUCTION (HTTPS):"
echo "    PORT=8443 TLS_CERT_FILE=./tls/cert.pem TLS_KEY_FILE=./tls/key.pem ./bin/$APP_NAME"
echo "    (add HTTP_REDIRECT_PORT=80 to auto-redirect plain HTTP -> HTTPS)"
echo
echo "  DEVELOPMENT (no rebuild needed):"
echo "    go run main.go"
echo "    (cd frontend && npm run dev)"
echo