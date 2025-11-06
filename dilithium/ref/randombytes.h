#ifndef RANDOMBYTES_H
#define RANDOMBYTES_H

#include <stddef.h>
#include <stdint.h>

// For WASM builds, use unsigned long long to match SPHINCS+ signature
// This allows both libraries to use the same randombytes implementation
#ifdef RANDOMBYTES_SIZE_T_IS_ULLONG
#include <stdint.h>
void randombytes(uint8_t *out, unsigned long long outlen);
#else
void randombytes(uint8_t *out, size_t outlen);
#endif

#endif
