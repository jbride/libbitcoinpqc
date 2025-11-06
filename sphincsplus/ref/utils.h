#ifndef SPX_UTILS_H
#define SPX_UTILS_H

#include "context.h"
#include "params.h"
#include <stdint.h>

/* To support MSVC use alloca() instead of VLAs. See #20. */
#ifdef __EMSCRIPTEN__
/* For WASM/Emscripten, use heap allocation instead of stack VLAs
   to avoid stack overflow issues. SPHINCS+ uses large VLAs that can
   cause stack overflow in WASM (e.g., tree_height=9 means ~1KB arrays).
   For shake-128s: SPX_TREE_HEIGHT = 9, so stack arrays are ~1KB each.

   Note: malloc failures should be rare, but if they occur, abort() will
   cause an "unreachable" trap in WASM. This is expected behavior for
   out-of-memory conditions. */
#include <stdlib.h>
#define SPX_VLA(__t, __x, __s)                                                 \
  __t *__x = (__t *)malloc((__s) * sizeof(__t));                               \
  if (!__x)                                                                    \
  abort()
#define SPX_VLA_FREE(__x)                                                      \
  do {                                                                         \
    if (__x)                                                                   \
      free(__x);                                                               \
  } while (0)
#elif defined(_MSC_VER)
/* MSVC defines _alloca in malloc.h */
#include <malloc.h>
/* Note: _malloca(), which is recommended over deprecated _alloca,
   requires that you call _freea(). So we stick with _alloca */
#define SPX_VLA(__t, __x, __s) __t *__x = (__t *)_alloca((__s) * sizeof(__t))
#define SPX_VLA_FREE(__x) ((void)0) /* No-op for _alloca */
#else
#define SPX_VLA(__t, __x, __s) __t __x[__s]
#define SPX_VLA_FREE(__x) ((void)0) /* No-op for VLAs */
#endif

/**
 * Converts the value of 'in' to 'outlen' bytes in big-endian byte order.
 */
#define ull_to_bytes SPX_NAMESPACE(ull_to_bytes)
void ull_to_bytes(unsigned char *out, unsigned int outlen,
                  unsigned long long in);
#define u32_to_bytes SPX_NAMESPACE(u32_to_bytes)
void u32_to_bytes(unsigned char *out, uint32_t in);

/**
 * Converts the inlen bytes in 'in' from big-endian byte order to an integer.
 */
#define bytes_to_ull SPX_NAMESPACE(bytes_to_ull)
unsigned long long bytes_to_ull(const unsigned char *in, unsigned int inlen);

/**
 * Computes a root node given a leaf and an auth path.
 * Expects address to be complete other than the tree_height and tree_index.
 */
#define compute_root SPX_NAMESPACE(compute_root)
void compute_root(unsigned char *root, const unsigned char *leaf,
                  uint32_t leaf_idx, uint32_t idx_offset,
                  const unsigned char *auth_path, uint32_t tree_height,
                  const spx_ctx *ctx, uint32_t addr[8]);

/**
 * For a given leaf index, computes the authentication path and the resulting
 * root node using Merkle's TreeHash algorithm.
 * Expects the layer and tree parts of the tree_addr to be set, as well as the
 * tree type (i.e. SPX_ADDR_TYPE_HASHTREE or SPX_ADDR_TYPE_FORSTREE).
 * Applies the offset idx_offset to indices before building addresses, so that
 * it is possible to continue counting indices across trees.
 */
#define treehash SPX_NAMESPACE(treehash)
void treehash(unsigned char *root, unsigned char *auth_path, const spx_ctx *ctx,
              uint32_t leaf_idx, uint32_t idx_offset, uint32_t tree_height,
              void (*gen_leaf)(unsigned char * /* leaf */,
                               const spx_ctx *ctx /* ctx */,
                               uint32_t /* addr_idx */,
                               const uint32_t[8] /* tree_addr */),
              uint32_t tree_addr[8]);

#endif
