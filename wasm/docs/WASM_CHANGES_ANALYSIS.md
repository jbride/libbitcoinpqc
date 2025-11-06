Analysis of WASM Commit Changes

## 1. 🌐 WASM vs Server Environments

WASM runtimes differ significantly from traditional server-side (POSIX-like) environments, which drove most of the changes outlined below:

- **No native filesystem**: WASM sandboxing blocks `/dev/urandom` and standard file APIs. Randomness must come from host-provided callbacks such as `crypto.getRandomValues`, accessed through `EM_ASM` bridges.
- **Tight stack limits**: Typical browser/runtime stacks are only a few hundred kilobytes; large automatic arrays (VLAs) overflow quickly. SPHINCS+ uses Variable Length Arrays (VLAs) extensively, which cause stack overflow in WASM due to limited stack size.  The updates move these allocations to the heap and add matching frees.
- **Host-managed memory**: All memory ultimately lives in a single linear buffer. Manual `malloc`/`free` coordination is critical to avoid leaks across JS ↔ C boundaries.
- **Single-threaded execution**: Main-thread WASM code runs without POSIX threads or signals, so synchronous error handling paths (e.g., `printf` debugging, blocking calls) need to be minimal and optional.
- **Foreign-function boundary**: Every call to C from JS (and vice versa) has a cost; the wrapper now exposes a higher-level, type-safe API while allowing low-level access for advanced use.

Keep these constraints in mind when evaluating future WASM-specific deltas; they explain why many changes look like regressions from a server-centric perspective but are mandatory inside browsers and similar hosts.

## 2. ✅ ESSENTIAL Changes (Must Keep for WASM)

### 2.1. Randombytes WASM Implementation (CRITICAL)
- **`src/slh_dsa/utils.c`**: 
  - **CRITICAL CHANGE**: Replaced `fopen("/dev/urandom")` with JavaScript `getRandomValues` via `EM_ASM`
    - Original code: `FILE *f = fopen("/dev/urandom", "r");` - **DOES NOT WORK IN WASM**
    - New code: Uses `EM_ASM_` to call JavaScript's `crypto.getRandomValues` or `Module.getRandomValues`
    - This is **essential** - without this, WASM cannot generate random numbers
  - Fixed JavaScript syntax error (`!==` instead of `!= =`)
  - Added `#include <emscripten.h>` for `EM_ASM` support
  - **Cannot be removed** - WASM has no access to `/dev/urandom` or file system
  - **Impact**: Without this change, WASM builds will fail to generate random numbers for key generation and signing

### 2.2. Signature Compatibility Fix

Dilithium’s C API declares randombytes as void randombytes(uint8_t *out, size_t outlen), while SPHINCS+ expects void randombytes(unsigned char *x, unsigned long long xlen). In a WASM build those two prototypes compile to different ABI signatures (i32 length vs i64 length), so a single implementation can’t satisfy both algorithms. The fix adds a WASM-specific header tweak that makes Dilithium adopt the wider unsigned long long parameter under WASM, letting the shared JS-backed RNG shim serve both schemes without duplicate bindings.

* **Dilithium** expects: `void randombytes(uint8_t *out, size_t outlen);`
* **SPHINCS+** expects: `void randombytes(unsigned char *x, unsigned long long xlen);`

In WASM, these are incompatible:
* `size_t` = `i32` (32-bit)
* `unsigned long long` = `i64` (64-bit)

- **`dilithium/ref/randombytes.h`**: Conditional `unsigned long long` signature for WASM builds
  - Allows both Dilithium and SPHINCS+ to use the same `randombytes` implementation
  - **Cannot be removed** - needed for signature compatibility

NOTE:  Non-WASM targets never set the macro, so Dilithium keeps its original size_t signature there. The only runtime “risk” is the abort in the wrapper if a caller ever asked for ≥4 GB of randomness—far beyond Dilithium’s needs.

### 2.3. VLA (Variable Length Array) to Heap Allocation

WASM has a limited stack size (default 1MB, configurable up to ~10MB). SPHINCS+ uses large VLAs that can exceed this:

* Tree height of 9 requires ~1KB arrays
* Multiple nested function calls compound stack usage
* Stack overflow causes "unreachable" WASM traps

In addition, all functions using `SPX_VLA` must call `SPX_VLA_FREE` before returning in WASM builds.

- **`sphincsplus/ref/utils.h`**: Modified `SPX_VLA` macro to use `malloc` for WASM
  - **Critical**: WASM stack is limited; VLAs cause stack overflow

- **`sphincsplus/ref/utils.c`**: Added `SPX_VLA_FREE` calls
  - **Critical**: Must free heap-allocated memory

- **`sphincsplus/ref/utilsx1.c`**: Added `SPX_VLA_FREE` calls and heap allocation
  - **Critical**: Memory management for WASM

### 2.4. Heap Allocation Changes (Stack Overflow Prevention)

Some functions use large fixed-size arrays that must be moved to heap.

- **`sphincsplus/ref/fors.c`**: 
  - `indices` and `roots` arrays moved to heap for WASM

- **`sphincsplus/ref/hash_shake.c`**:
  - `s_inc` and `buf` arrays moved to heap for WASM

- **`sphincsplus/ref/merkle.c`**:
  - `steps` array moved to heap for WASM

- **`sphincsplus/ref/wotsx1.c`**:
  - `pk_buffer` moved to heap for WASM

- **`sphincsplus/ref/thash_shake_robust.c`** and **`thash_shake_simple.c`**:
  - Added `SPX_VLA_FREE` calls
  - **Cannot be removed** - memory leak prevention

### 2.5. Include Fix
- **`sphincsplus/ref/merkle.h`**: Added `#include "context.h"`
  - **Necessary**: Ensures `spx_ctx` type is defined

---

## 3. 🎨 COSMETIC/STYLE Changes (Can Be Reverted)

These changes don't affect functionality but improve code style:

### 3.1. Include Order Changes:
- **`sphincsplus/ref/fors.c`**: Reordered includes (alphabetical/style preference)
- **`sphincsplus/ref/sign.c`**: Reordered includes

### 3.2. Code Formatting:
- Function brace placement (`{` on same line vs. new line)
- Whitespace adjustments
- Function parameter formatting

**Recommendation**: You can revert these if you prefer the original style, but they don't affect functionality.

---

