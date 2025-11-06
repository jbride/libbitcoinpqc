#!/usr/bin/env node

/**
 * Node.js test script for Bitcoin PQC WASM module
 * 
 * Usage: node test-node.js
 * 
 * This script tests the WASM module from the command line, which is useful
 * for debugging without browser overhead.
 */

const path = require('path');

// Load the WASM module using require (Emscripten generates CommonJS-compatible code)
let Module;
let moduleFactory;

try {
    moduleFactory = require('./../dist/bitcoinpqc.js');
} catch (error) {
    console.error('Failed to load WASM module:', error);
    console.error('Make sure you have built the WASM module first:');
    console.error('  cd wasm && ./bin/build.sh');
    process.exit(1);
}

// Configuration for Node.js environment
// Will be set in initModule() after functions are defined
let moduleConfig;

// Helper functions (must be defined after Module is available)
function readUint32(ptr) {
    if (Module.HEAP32) {
        return (Module.HEAP32[ptr >> 2] >>> 0);
    }
    const heap = Module.HEAP8;
    return (heap[ptr] | (heap[ptr + 1] << 8) | (heap[ptr + 2] << 16) | (heap[ptr + 3] << 24)) >>> 0;
}

function readPointer(ptr) {
    return readUint32(ptr);
}

function getKeySizes(algorithm) {
    const pkSize = Module.ccall('bitcoin_pqc_public_key_size', 'number', ['number'], [algorithm]);
    const skSize = Module.ccall('bitcoin_pqc_secret_key_size', 'number', ['number'], [algorithm]);
    const sigSize = Module.ccall('bitcoin_pqc_signature_size', 'number', ['number'], [algorithm]);
    return { pkSize, skSize, sigSize };
}

function generateRandomBytes(length) {
    const array = new Uint8Array(length);
    const crypto = require('crypto');
    const randomBytes = crypto.randomBytes(length);
    array.set(randomBytes);
    return array;
}

function generateKeypair(algorithm, randomData) {
    const randomPtr = Module._malloc(randomData.length);
    Module.HEAP8.set(randomData, randomPtr);

    const keypairPtr = Module._malloc(32);

    const result = Module.ccall(
        'bitcoin_pqc_keygen',
        'number',
        ['number', 'number', 'number', 'number'],
        [algorithm, keypairPtr, randomPtr, randomData.length]
    );

    Module._free(randomPtr);

    if (result !== 0) {
        Module._free(keypairPtr);
        throw new Error('Key generation failed with error code: ' + result);
    }

    const publicKeyPtr = readPointer(keypairPtr + 4);
    const secretKeyPtr = readPointer(keypairPtr + 8);
    const publicKeySize = readUint32(keypairPtr + 12);
    const secretKeySize = readUint32(keypairPtr + 16);

    const publicKey = Module.HEAP8.subarray(publicKeyPtr, publicKeyPtr + publicKeySize);
    const secretKey = Module.HEAP8.subarray(secretKeyPtr, secretKeyPtr + secretKeySize);

    const publicKeyCopy = new Uint8Array(publicKey);
    const secretKeyCopy = new Uint8Array(secretKey);

    return {
        keypairPtr,
        publicKey: publicKeyCopy,
        secretKey: secretKeyCopy,
        publicKeySize,
        secretKeySize
    };
}

function signMessage(algorithm, secretKey, message) {
    if (!secretKey || secretKey.length === 0) {
        throw new Error('Invalid secret key: empty or null');
    }

    const expectedSkSize = getKeySizes(algorithm).skSize;
    if (secretKey.length !== expectedSkSize) {
        throw new Error(`Secret key size mismatch: expected ${expectedSkSize}, got ${secretKey.length}`);
    }

    const secretKeyPtr = Module._malloc(secretKey.length);
    Module.HEAP8.set(secretKey, secretKeyPtr);

    const messagePtr = Module._malloc(message.length);
    Module.HEAP8.set(message, messagePtr);

    const signaturePtr = Module._malloc(16);
    Module.HEAP8.fill(0, signaturePtr, signaturePtr + 16);

    if (Module.HEAP32) {
        Module.HEAP32[signaturePtr >> 2] = algorithm;
    } else {
        Module.HEAP8[signaturePtr] = algorithm & 0xFF;
        Module.HEAP8[signaturePtr + 1] = (algorithm >> 8) & 0xFF;
        Module.HEAP8[signaturePtr + 2] = (algorithm >> 16) & 0xFF;
        Module.HEAP8[signaturePtr + 3] = (algorithm >> 24) & 0xFF;
    }

    let result;
    try {
        result = Module.ccall(
            'bitcoin_pqc_sign',
            'number',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [algorithm, secretKeyPtr, secretKey.length, messagePtr, message.length, signaturePtr]
        );
    } catch (error) {
        Module._free(secretKeyPtr);
        Module._free(messagePtr);
        Module._free(signaturePtr);
        throw new Error(`WASM error during signing: ${error.message}`);
    }

    Module._free(secretKeyPtr);
    Module._free(messagePtr);

    if (result !== 0) {
        Module._free(signaturePtr);
        const errorMsg = result === -1 ? 'BAD_ARG' : result === -2 ? 'BAD_KEY' : result === -3 ? 'BAD_SIGNATURE' : result === -4 ? 'NOT_IMPLEMENTED' : `UNKNOWN(${result})`;
        throw new Error(`Signing failed with error code: ${result} (${errorMsg})`);
    }

    const signatureDataPtr = readPointer(signaturePtr + 4);
    const signatureSize = readUint32(signaturePtr + 8);

    const signature = Module.HEAP8.subarray(signatureDataPtr, signatureDataPtr + signatureSize);
    const signatureCopy = new Uint8Array(signature);

    return {
        signaturePtr,
        signature: signatureCopy,
        signatureSize
    };
}

function verifySignature(algorithm, publicKey, message, signature) {
    const publicKeyPtr = Module._malloc(publicKey.length);
    Module.HEAP8.set(publicKey, publicKeyPtr);

    const messagePtr = Module._malloc(message.length);
    Module.HEAP8.set(message, messagePtr);

    const signaturePtr = Module._malloc(signature.length);
    Module.HEAP8.set(signature, signaturePtr);

    const result = Module.ccall(
        'bitcoin_pqc_verify',
        'number',
        ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [algorithm, publicKeyPtr, publicKey.length, messagePtr, message.length, signaturePtr, signature.length]
    );

    Module._free(publicKeyPtr);
    Module._free(messagePtr);
    Module._free(signaturePtr);

    return result === 0;
}

// Test function
async function testAlgorithm(algorithm, name) {
    console.log(`\nTesting ${name} algorithm:`);
    console.log('------------------------');

    try {
        const { pkSize, skSize, sigSize } = getKeySizes(algorithm);
        console.log(`Public key size: ${pkSize} bytes`);
        console.log(`Secret key size: ${skSize} bytes`);
        console.log(`Signature size: ${sigSize} bytes`);

        const randomData = generateRandomBytes(128);

        const keygenStart = Date.now();
        const keypair = generateKeypair(algorithm, randomData);
        const keygenDuration = Date.now() - keygenStart;
        console.log(`Key generation time: ${keygenDuration} ms`);

        const messageText = 'This is a test message for PQC signature verification';
        const message = Buffer.from(messageText, 'utf8');
        console.log(`Message to sign: "${messageText}"`);
        console.log(`Message length: ${message.length} bytes`);

        const signStart = Date.now();
        let signatureData;
        try {
            signatureData = signMessage(algorithm, keypair.secretKey, message);
            const signDuration = Date.now() - signStart;
            console.log(`Signing time: ${signDuration} ms`);
            console.log(`Actual signature size: ${signatureData.signatureSize} bytes`);
        } catch (error) {
            const signDuration = Date.now() - signStart;
            console.log(`Signing failed after ${signDuration} ms`);
            console.log(`Error: ${error.message}`);
            if (algorithm === 2) {
                console.log('');
                console.log('⚠️  NOTE: SLH-DSA-SHAKE-128s signing is currently experiencing');
                console.log('   issues when compiled to WebAssembly. This appears to be a');
                console.log('   bug in the SPHINCS+ reference implementation when compiled');
                console.log('   to WASM. ML-DSA-44 (Dilithium) works correctly.');
                console.log('');
                console.log('   Key generation succeeded, but signing failed.');
                console.log('   This is a known limitation of the browser/WASM build.');
            }
            Module.ccall('bitcoin_pqc_keypair_free', null, ['number'], [keypair.keypairPtr]);
            throw error;
        }

        const verifyStart = Date.now();
        const verifyResult = verifySignature(
            algorithm,
            keypair.publicKey,
            message,
            signatureData.signature
        );
        const verifyDuration = Date.now() - verifyStart;

        if (verifyResult) {
            console.log('Signature verified successfully!');
        } else {
            console.log('ERROR: Signature verification failed!');
        }
        console.log(`Verification time: ${verifyDuration} ms`);

        const modifiedMessageText = 'This is a MODIFIED message for PQC signature verification';
        const modifiedMessage = Buffer.from(modifiedMessageText, 'utf8');
        console.log(`Modified message: "${modifiedMessageText}"`);
        const modifiedVerifyResult = verifySignature(
            algorithm,
            keypair.publicKey,
            modifiedMessage,
            signatureData.signature
        );

        if (modifiedVerifyResult) {
            console.log('ERROR: Signature verified for modified message!');
        } else {
            console.log('Correctly rejected signature for modified message');
        }

        Module.ccall('bitcoin_pqc_keypair_free', null, ['number'], [keypair.keypairPtr]);
        Module.ccall('bitcoin_pqc_signature_free', null, ['number'], [signatureData.signaturePtr]);

        console.log('✓ Test passed!\n');
        return true;
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        if (error.stack) {
            console.error(error.stack);
        }
        return false;
    }
}

async function runTests() {
    console.log('Bitcoin PQC Library Example (Node.js)');
    console.log('=====================================\n');
    console.log('This example tests the post-quantum signature algorithms designed for BIP-360 and the Bitcoin QuBit soft fork.\n');

    const results = [];

    // Test ML-DSA-44
    results.push(await testAlgorithm(1, 'ML-DSA-44'));

    // Test SLH-DSA-Shake-128s
    results.push(await testAlgorithm(2, 'SLH-DSA-Shake-128s'));

    // Summary
    console.log('\n=====================================');
    console.log('Test Summary:');
    console.log(`  ML-DSA-44: ${results[0] ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`  SLH-DSA-Shake-128s: ${results[1] ? '✓ PASSED' : '✗ FAILED'}`);
    console.log('=====================================\n');

    const exitCode = results.every(r => r) ? 0 : 1;
    process.exit(exitCode);
}

// Initialize the module
async function initModule() {
    try {
        // Create config - the callback will be called during initialization,
        // but we'll run tests after the promise resolves
        moduleConfig = {
            onRuntimeInitialized: function () {
                // This callback is called during initialization
                // but we'll run tests after await completes
            },
            print: function (text) {
                // Enable WASM print output for debugging
                console.log('WASM:', text);
            },
            printErr: function (text) {
                console.error('WASM Error:', text);
            },
            // Node.js-specific: provide crypto.getRandomValues
            getRandomValues: function (arr) {
                const crypto = require('crypto');
                const randomBytes = crypto.randomBytes(arr.length);
                arr.set(randomBytes);
                return arr;
            }
        };

        // Module factory returns a Promise that resolves to the Module instance
        // The onRuntimeInitialized callback will be called during this await
        Module = await moduleFactory(moduleConfig);

        // Now Module is fully initialized and available
        console.log('✓ WASM module initialized successfully!\n');
        runTests();
    } catch (error) {
        console.error('Failed to initialize module:', error);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Start
initModule();
