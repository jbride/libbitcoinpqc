#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

// Forward declaration from SPHINCS+ utils.c
extern void custom_slh_randombytes_impl(uint8_t *out, size_t outlen);

// Provide randombytes with SPHINCS+ signature (unsigned long long)
// This is what SPHINCS+ expects. Dilithium will need to be compatible.
// In WASM, we'll handle the conversion from size_t to unsigned long long
// when Dilithium calls it.
void randombytes(unsigned char *out, unsigned long long outlen) {
  // Convert unsigned long long to size_t (safe conversion up to SIZE_MAX)
  // In WASM, unsigned long long is 64-bit, but size_t is 32-bit
  // So we need to handle the conversion carefully
  if (outlen > SIZE_MAX) {
    // This shouldn't happen in practice, but handle it gracefully
    abort();
  }
  custom_slh_randombytes_impl((uint8_t *)out, (size_t)outlen);
}
