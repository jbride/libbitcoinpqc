/**
 * Bitcoin PQC WebAssembly Library
 * 
 * This module provides a TypeScript/JavaScript wrapper for the Bitcoin PQC
 * WebAssembly library, supporting both browser and Node.js environments.
 */

// Type definitions
export enum Algorithm {
    ML_DSA_44 = 1,
    SLH_DSA_SHAKE_128S = 2,
}

export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
    publicKeySize: number;
    secretKeySize: number;
}

export interface Signature {
    bytes: Uint8Array;
    size: number;
}

export interface ModuleConfig {
    getRandomValues?: (arr: Uint8Array) => Uint8Array;
    onRuntimeInitialized?: () => void;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
}

export interface BitcoinPQCModule {
    ccall: (func: string, returnType: string, argTypes: string[], args: any[]) => any;
    cwrap: (func: string, returnType: string, argTypes: string[]) => Function;
    _malloc: (size: number) => number;
    _free: (ptr: number) => void;
    HEAP8: Uint8Array;
    HEAP32: Int32Array;
    HEAPU8: Uint8Array;
}

/**
 * BitcoinPQC class - Main interface for the WASM library
 */
export class BitcoinPQC {
    private module: BitcoinPQCModule | null = null;
    private initialized: boolean = false;

    /**
     * Initialize the WASM module
     * @param config Optional configuration for the module
     * @returns Promise that resolves when the module is ready
     */
    async init(config?: ModuleConfig): Promise<void> {
        if (this.initialized && this.module) {
            return;
        }

        // Dynamic import for browser/node compatibility
        let moduleFactory: any;

        // Check if we're in a browser environment
        // Use type guards to avoid TypeScript errors
        const hasWindow = typeof (globalThis as any).window !== 'undefined' ||
            (typeof (globalThis as any) !== 'undefined' && 'document' in (globalThis as any));
        const isBrowser = hasWindow;

        if (isBrowser) {
            // Browser: Check if Module is available globally (from script tag)
            const globalModule = (typeof globalThis !== 'undefined' ? (globalThis as any).Module : undefined) ||
                (typeof (globalThis as any).window !== 'undefined' ? ((globalThis as any).window as any).Module : undefined);

            if (globalModule) {
                moduleFactory = globalModule;
            } else {
                // Try to load via dynamic import (bitcoinpqc.js should be in same directory as dist/index.js)
                // Use type assertion to avoid TypeScript error about missing module
                try {
                    const module = await import('./bitcoinpqc.js' as any);
                    moduleFactory = module.default || module;
                } catch (error) {
                    throw new Error('bitcoinpqc.js not found. Make sure it is built and accessible. Error: ' + (error as Error).message);
                }
            }
        } else {
            // Node.js - use dynamic import for ES module compatibility
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            // Use require for path and fs since they're CommonJS modules
            const path = require('path');
            const fs = require('fs');

            // Get the directory of the current module
            // import.meta.url is a file:// URL, need to convert to path
            const currentFileUrl = import.meta.url;
            const __dirname = path.dirname(
                currentFileUrl.startsWith('file://')
                    ? new URL(currentFileUrl).pathname
                    : currentFileUrl
            );
            // In dist/, bitcoinpqc.js should be in the same directory
            const wasmPath = path.join(__dirname, './bitcoinpqc.js');

            if (!fs.existsSync(wasmPath)) {
                throw new Error(`bitcoinpqc.js not found at ${wasmPath}. Make sure to build the WASM module first.`);
            }
            moduleFactory = require(wasmPath);
        }

        // Create module configuration
        const moduleConfig: any = {
            onRuntimeInitialized: () => {
                if (config?.onRuntimeInitialized) {
                    config.onRuntimeInitialized();
                }
            },
            print: config?.print || ((text: string) => console.log('WASM:', text)),
            printErr: config?.printErr || ((text: string) => console.error('WASM Error:', text)),
            getRandomValues: config?.getRandomValues || await this.getDefaultRandomValues(),
        };

        // Initialize module
        this.module = await moduleFactory(moduleConfig);
        this.initialized = true;
    }

    /**
     * Get default random values implementation
     */
    private async getDefaultRandomValues(): Promise<(arr: Uint8Array) => Uint8Array> {
        // Check for browser crypto API
        if (typeof globalThis !== 'undefined' && typeof (globalThis as any).crypto !== 'undefined' &&
            typeof (globalThis as any).crypto.getRandomValues === 'function') {
            return (arr: Uint8Array) => (globalThis as any).crypto.getRandomValues(arr);
        }
        // Check for window.crypto (browser) - use globalThis to avoid TypeScript errors
        const win = (typeof globalThis !== 'undefined' && (globalThis as any).window) ? (globalThis as any).window : undefined;
        if (win && typeof win.crypto !== 'undefined' && typeof win.crypto.getRandomValues === 'function') {
            return (arr: Uint8Array) => win.crypto.getRandomValues(arr);
        }
        // Node.js fallback - use dynamic import for ES module compatibility
        try {
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);
            const crypto = require('crypto');
            return (arr: Uint8Array) => {
                const randomBytes = crypto.randomBytes(arr.length);
                arr.set(randomBytes);
                return arr;
            };
        } catch (error) {
            throw new Error('No random number generator available');
        }
    }

    /**
     * Ensure module is initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized || !this.module) {
            throw new Error('Module not initialized. Call init() first.');
        }
    }

    /**
     * Get public key size for an algorithm
     */
    publicKeySize(algorithm: Algorithm): number {
        this.ensureInitialized();
        return this.module!.ccall('bitcoin_pqc_public_key_size', 'number', ['number'], [algorithm]);
    }

    /**
     * Get secret key size for an algorithm
     */
    secretKeySize(algorithm: Algorithm): number {
        this.ensureInitialized();
        return this.module!.ccall('bitcoin_pqc_secret_key_size', 'number', ['number'], [algorithm]);
    }

    /**
     * Get signature size for an algorithm
     */
    signatureSize(algorithm: Algorithm): number {
        this.ensureInitialized();
        return this.module!.ccall('bitcoin_pqc_signature_size', 'number', ['number'], [algorithm]);
    }

    /**
     * Generate a key pair
     * @param algorithm The algorithm to use
     * @param randomData Random bytes for key generation (128 bytes recommended)
     */
    generateKeypair(algorithm: Algorithm, randomData: Uint8Array): KeyPair {
        this.ensureInitialized();
        const mod = this.module!;

        const randomPtr = mod._malloc(randomData.length);
        mod.HEAP8.set(randomData, randomPtr);

        const keypairPtr = mod._malloc(32);

        const result = mod.ccall(
            'bitcoin_pqc_keygen',
            'number',
            ['number', 'number', 'number', 'number'],
            [algorithm, keypairPtr, randomPtr, randomData.length]
        );

        mod._free(randomPtr);

        if (result !== 0) {
            mod._free(keypairPtr);
            throw new Error(`Key generation failed with error code: ${result}`);
        }

        // Read keypair structure
        const publicKeyPtr = this.readUint32(keypairPtr + 4);
        const secretKeyPtr = this.readUint32(keypairPtr + 8);
        const publicKeySize = this.readUint32(keypairPtr + 12);
        const secretKeySize = this.readUint32(keypairPtr + 16);

        // Read keys from memory
        const publicKey = new Uint8Array(mod.HEAP8.subarray(publicKeyPtr, publicKeyPtr + publicKeySize));
        const secretKey = new Uint8Array(mod.HEAP8.subarray(secretKeyPtr, secretKeyPtr + secretKeySize));

        return {
            publicKey,
            secretKey,
            publicKeySize,
            secretKeySize,
        };
    }

    /**
     * Sign a message
     * @param secretKey The secret key
     * @param message The message to sign
     * @param algorithm The algorithm to use
     */
    sign(secretKey: Uint8Array, message: Uint8Array, algorithm: Algorithm): Signature {
        this.ensureInitialized();
        const mod = this.module!;

        const secretKeyPtr = mod._malloc(secretKey.length);
        mod.HEAP8.set(secretKey, secretKeyPtr);

        const messagePtr = mod._malloc(message.length);
        mod.HEAP8.set(message, messagePtr);

        const signaturePtr = mod._malloc(16);
        mod.HEAP8.fill(0, signaturePtr, signaturePtr + 16);

        // Set algorithm field
        if (mod.HEAP32) {
            mod.HEAP32[signaturePtr >> 2] = algorithm;
        } else {
            mod.HEAP8[signaturePtr] = algorithm & 0xFF;
            mod.HEAP8[signaturePtr + 1] = (algorithm >> 8) & 0xFF;
            mod.HEAP8[signaturePtr + 2] = (algorithm >> 16) & 0xFF;
            mod.HEAP8[signaturePtr + 3] = (algorithm >> 24) & 0xFF;
        }

        const result = mod.ccall(
            'bitcoin_pqc_sign',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [algorithm, secretKeyPtr, secretKey.length, messagePtr, message.length, signaturePtr]
        );

        mod._free(secretKeyPtr);
        mod._free(messagePtr);

        if (result !== 0) {
            mod._free(signaturePtr);
            throw new Error(`Signing failed with error code: ${result}`);
        }

        // Read signature structure
        const signatureDataPtr = this.readUint32(signaturePtr + 4);
        const signatureSize = this.readUint32(signaturePtr + 8);

        const signature = new Uint8Array(mod.HEAP8.subarray(signatureDataPtr, signatureDataPtr + signatureSize));

        return {
            bytes: signature,
            size: signatureSize,
        };
    }

    /**
     * Verify a signature
     * @param publicKey The public key
     * @param message The original message
     * @param signature The signature to verify
     * @param algorithm The algorithm to use
     */
    verify(publicKey: Uint8Array, message: Uint8Array, signature: Signature, algorithm: Algorithm): boolean {
        this.ensureInitialized();
        const mod = this.module!;

        const publicKeyPtr = mod._malloc(publicKey.length);
        mod.HEAP8.set(publicKey, publicKeyPtr);

        const messagePtr = mod._malloc(message.length);
        mod.HEAP8.set(message, messagePtr);

        const signaturePtr = mod._malloc(signature.bytes.length);
        mod.HEAP8.set(signature.bytes, signaturePtr);

        const result = mod.ccall(
            'bitcoin_pqc_verify',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
            [algorithm, publicKeyPtr, publicKey.length, messagePtr, message.length, signaturePtr, signature.bytes.length]
        );

        mod._free(publicKeyPtr);
        mod._free(messagePtr);
        mod._free(signaturePtr);

        return result === 0; // BITCOIN_PQC_OK = 0
    }

    /**
     * Read a 32-bit unsigned integer from WASM memory
     */
    private readUint32(ptr: number): number {
        const mod = this.module!;
        if (mod.HEAP32) {
            return (mod.HEAP32[ptr >> 2] >>> 0);
        }
        const heap = mod.HEAP8;
        return (heap[ptr] | (heap[ptr + 1] << 8) | (heap[ptr + 2] << 16) | (heap[ptr + 3] << 24)) >>> 0;
    }

    /**
     * Get the underlying WASM module (for advanced usage)
     */
    getModule(): BitcoinPQCModule {
        this.ensureInitialized();
        return this.module!;
    }
}

// Export a singleton instance
export const bitcoinpqc = new BitcoinPQC();

// Export default
export default bitcoinpqc;

