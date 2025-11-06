#!/bin/bash

# Build script to compile Bitcoin PQC C libraries to WebAssembly using Emscripten
# Prerequisites: Emscripten SDK must be installed and activated

set -e

echo "Building Bitcoin PQC libraries for WebAssembly..."

# Check if Emscripten is available
if ! command -v emcc &> /dev/null; then
    echo "Error: Emscripten (emcc) not found!"
    echo "Please install and activate Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# Get the project root directory (assuming script is in wasm/bin)
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo $PROJECT_ROOT
cd "$PROJECT_ROOT"

# Output directory
OUTPUT_DIR="wasm/dist"
mkdir -p "$OUTPUT_DIR"

# Emscripten compilation flags
EMCC_FLAGS=(
    -O2                              # Use O2 instead of O3 (O3 can break VLAs in WASM)
    -s WASM=1                        # Output WebAssembly
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","HEAP8","HEAP32","HEAPU8"]'
    -s EXPORTED_FUNCTIONS='["_bitcoin_pqc_keygen","_bitcoin_pqc_public_key_size","_bitcoin_pqc_secret_key_size","_bitcoin_pqc_signature_size","_bitcoin_pqc_keypair_free","_bitcoin_pqc_sign","_bitcoin_pqc_signature_free","_bitcoin_pqc_verify","_malloc","_free"]'
    -s ALLOW_MEMORY_GROWTH=1         # Allow memory to grow
    -s INITIAL_MEMORY=33554432       # 32MB initial memory
    -s MAXIMUM_MEMORY=134217728      # 128MB max memory
    -s STACK_SIZE=10485760           # 10MB stack (SPHINCS+ needs significant stack space)
    -s TOTAL_STACK=10485760          # Total stack size
    -s MODULARIZE=1                  # Use module pattern
    -s EXPORT_NAME="Module"          # Module name
    -s STANDALONE_WASM=0             # Enable JS glue code
    --no-entry                       # No main function
)

# Include directories
INCLUDE_DIRS=(
    -I"$PROJECT_ROOT/include"
    -I"$PROJECT_ROOT/dilithium/ref"
    -I"$PROJECT_ROOT/sphincsplus/ref"
)

# Source files for bitcoinpqc main API
BITCOINPQC_SOURCES=(
    "$PROJECT_ROOT/src/bitcoinpqc.c"
    "$PROJECT_ROOT/src/ml_dsa/keygen.c"
    "$PROJECT_ROOT/src/ml_dsa/sign.c"
    "$PROJECT_ROOT/src/ml_dsa/verify.c"
    "$PROJECT_ROOT/src/ml_dsa/utils.c"
    "$PROJECT_ROOT/src/slh_dsa/keygen.c"
    "$PROJECT_ROOT/src/slh_dsa/sign.c"
    "$PROJECT_ROOT/src/slh_dsa/verify.c"
    "$PROJECT_ROOT/src/slh_dsa/utils.c"
)

# Dilithium reference implementation sources
# Note: We use a shared randombytes implementation (from sphincsplus) to avoid signature conflicts
DILITHIUM_SOURCES=(
    "$PROJECT_ROOT/dilithium/ref/sign.c"
    "$PROJECT_ROOT/dilithium/ref/packing.c"
    "$PROJECT_ROOT/dilithium/ref/polyvec.c"
    "$PROJECT_ROOT/dilithium/ref/poly.c"
    "$PROJECT_ROOT/dilithium/ref/ntt.c"
    "$PROJECT_ROOT/dilithium/ref/reduce.c"
    "$PROJECT_ROOT/dilithium/ref/rounding.c"
    "$PROJECT_ROOT/dilithium/ref/fips202.c"
    "$PROJECT_ROOT/dilithium/ref/symmetric-shake.c"
    # Exclude dilithium randombytes_custom.c - use sphincsplus version instead
)

# SPHINCS+ reference implementation sources
# Note: We exclude randombytes_custom.c and use our unified wrapper instead
SPHINCSPLUS_SOURCES=(
    "$PROJECT_ROOT/sphincsplus/ref/address.c"
    "$PROJECT_ROOT/sphincsplus/ref/fors.c"
    "$PROJECT_ROOT/sphincsplus/ref/hash_shake.c"
    "$PROJECT_ROOT/sphincsplus/ref/merkle.c"
    "$PROJECT_ROOT/sphincsplus/ref/sign.c"
    "$PROJECT_ROOT/sphincsplus/ref/thash_shake_simple.c"
    "$PROJECT_ROOT/sphincsplus/ref/utils.c"
    "$PROJECT_ROOT/sphincsplus/ref/utilsx1.c"
    "$PROJECT_ROOT/sphincsplus/ref/wots.c"
    "$PROJECT_ROOT/sphincsplus/ref/wotsx1.c"
    "$PROJECT_ROOT/sphincsplus/ref/fips202.c"
)

# Unified randombytes wrapper (replaces both randombytes_custom.c implementations)
WRAPPER_SOURCES=(
    "$PROJECT_ROOT/wasm/src/randombytes_wrapper.c"
)

# Combine all sources
ALL_SOURCES=(
    "${BITCOINPQC_SOURCES[@]}"
    "${DILITHIUM_SOURCES[@]}"
    "${SPHINCSPLUS_SOURCES[@]}"
    "${WRAPPER_SOURCES[@]}"
)

# Compile with Emscripten
echo "Compiling C sources to WebAssembly..."
echo "Note: This may take a few minutes due to large codebase..."

emcc "${EMCC_FLAGS[@]}" \
    "${INCLUDE_DIRS[@]}" \
    "${ALL_SOURCES[@]}" \
    -DDILITHIUM_MODE=2 \
    -DCRYPTO_ALGNAME=\"SPHINCS+-shake-128s\" \
    -DPARAMS=sphincs-shake-128s \
    -DCUSTOM_RANDOMBYTES=1 \
    -DRANDOMBYTES_SIZE_T_IS_ULLONG=1 \
    -Wno-unused-command-line-argument \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
    -Wl,--allow-undefined \
    -Wl,--no-entry \
    -o "$OUTPUT_DIR/bitcoinpqc.js"

echo "✓ Build complete!"
echo ""
echo "Output files:"
echo "  - $OUTPUT_DIR/bitcoinpqc.js"
echo "  - $OUTPUT_DIR/bitcoinpqc.wasm"
echo ""
echo "To test, open: $OUTPUT_DIR/index.html in a web browser"
echo ""
echo "Note: You may need to serve this via a web server due to CORS restrictions:"
echo "  python3 -m http.server 8000"
echo "  # Then open http://localhost:8000/wasm/"
