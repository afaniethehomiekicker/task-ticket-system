@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM APEX CORE - Windows Single Binary Build Script
REM ============================================================

cd /d "%~dp0"

set "ROOT=%CD%"
set "APP_NAME=apex-core"
set "WITH_TLS=1"

if "%~1"=="--http" (
    set "WITH_TLS=0"
    shift
)

if "%~1"=="--help" goto :help
if "%~1"=="-h" goto :help
if not "%~1"=="" (
    echo ERROR: Unknown argument: %~1
    echo Try --help for usage information.
    exit /b 1
)

echo.
echo ============================================================
echo   APEX CORE - Windows Build
echo ============================================================
echo.

REM ============================================================
REM [1/3] Build frontend
REM ============================================================

echo [1/3] Bundling the web interface ^(frontend^)...
echo.

if not exist "frontend\node_modules" (
    echo Installing frontend dependencies ^(first run^)...
    cd frontend
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo ERROR: Frontend dependency installation failed.
        exit /b 1
    )
    cd ..
)

cd frontend
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed.
    exit /b 1
)
cd ..

REM ============================================================
REM [2/3] TLS certificates
REM ============================================================

echo.
echo [2/3] TLS certificates...
echo.

if "%WITH_TLS%"=="1" (
    if not exist "tls" mkdir tls

    set "CERT=tls\cert.pem"
    set "KEY=tls\key.pem"

    if exist "!CERT!" if exist "!KEY!" (
        echo Reusing existing certificates:
        echo   !CERT!
        echo   !KEY!
    ) else (
        where openssl >nul 2>&1
        if errorlevel 1 (
            echo ERROR: OpenSSL is not installed and no certificates exist.
            echo Install OpenSSL, add it to PATH, or run:
            echo   win-build.bat --http
            exit /b 1
        )

        echo Generating self-signed TLS certificates...

        openssl req -x509 -newkey rsa:2048 -sha256 -days 825 ^
            -nodes -keyout "!KEY!" -out "!CERT!" ^
            -subj "/CN=apex-core.local/O=APEX CORE"

        if errorlevel 1 (
            echo ERROR: Failed to generate TLS certificates.
            exit /b 1
        )

        echo.
        echo Generated self-signed certificates:
        echo   !CERT!
        echo   !KEY!
        echo.
        echo NOTE: Self-signed certificates are for testing only.
        echo Replace them with trusted certificates for production.
    )
) else (
    echo Plain HTTP build requested - no TLS artifacts created.
)

REM ============================================================
REM [3/3] Compile single Windows executable
REM ============================================================

echo.
echo [3/3] Compiling the single Windows executable...
echo.

if not exist "bin" mkdir bin

set "VERSION="

for /f "delims=" %%V in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyy.MM.dd')"') do (
    set "VERSION=%%V"
)

git rev-parse --short HEAD >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%H in ('git rev-parse --short HEAD') do (
        set "VERSION=!VERSION!-%%H"
    )
) else (
    set "VERSION=!VERSION!-dev"
)

echo Build version: !VERSION!

set "LDFLAGS=-s -w -X main.buildVersion=!VERSION!"

go build -trimpath -ldflags "!LDFLAGS!" -o "bin\%APP_NAME%.exe" .

if errorlevel 1 (
    echo.
    echo ERROR: Go compilation failed.
    exit /b 1
)

echo.
echo ============================================================
echo   APEX CORE build complete
echo   Version: !VERSION!
echo   Single binary: %ROOT%\bin\%APP_NAME%.exe
if "%WITH_TLS%"=="1" (
    echo   TLS key/cert: %ROOT%\tls\key.pem / %ROOT%\tls\cert.pem
)
echo ============================================================
echo.
echo PRODUCTION ^(HTTPS^):
echo   Set PORT=8443
echo   Set TLS_CERT_FILE=.\tls\cert.pem
echo   Set TLS_KEY_FILE=.\tls\key.pem
echo   bin\%APP_NAME%.exe
echo.
echo DEVELOPMENT ^(no rebuild needed^):
echo   go run main.go
echo   cd frontend ^&^& npm run dev
echo.
exit /b 0

REM ============================================================
REM HELP
REM ============================================================

:help
echo.
echo APEX CORE - Windows Build Script
echo.
echo Usage:
echo   win-build.bat
echo   win-build.bat --http
echo   win-build.bat --help
echo.
echo Options:
echo   --http    Build without TLS certificate generation.
echo   --help    Display this help message.
echo.
exit /b 0