#ifndef RANDOMBYTES_UNIFIED_H
#define RANDOMBYTES_UNIFIED_H

#include <stddef.h>
#include <stdint.h>

// Unified randombytes declaration that works for both Dilithium and SPHINCS+
// Using size_t which is 32-bit in WASM
void randombytes(uint8_t *out, size_t outlen);

#endif
