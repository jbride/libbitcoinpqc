# Publishing @jbride/bitcoinpqc-wasm to npm

## Prerequisites

1. **Emscripten SDK** must be installed and activated (required for building WASM)
2. **Node.js** 14+ installed
3. **npm** account with access to `@jbride` scope

## Build Steps

1. **Install dependencies:**
   ```bash
   cd wasm
   npm install
   ```

2. **Build the package:**
   ```bash
   npm run build
   ```
   
   This will:
   - Compile C sources to WebAssembly (`build:wasm`)
   - Compile TypeScript to JavaScript (`build:ts`)
   - Copy WASM files to `dist/` (`copy:wasm`)

3. **Test the build:**
   ```bash
   npm test
   ```

4. **Verify what will be published:**
   ```bash
   npm pack --dry-run
   ```
   
   This shows what files will be included in the package.

## Publishing

1. **Ensure you're logged into npm:**
   ```bash
   npm login
   ```

2. **Publish the package:**
   ```bash
   npm publish
   ```
   
   The `prepublishOnly` script will automatically:
   - Build the WASM module
   - Compile TypeScript
   - Copy WASM files to dist/

## Package Structure

After publishing, the package will contain:

```
@jbride/bitcoinpqc-wasm/
├── dist/
│   ├── index.js           # Compiled JavaScript
│   ├── index.d.ts         # TypeScript definitions
│   ├── bitcoinpqc.js      # WASM glue code
│   └── bitcoinpqc.wasm    # WebAssembly binary
├── README.md
├── package.json
└── LICENSE
```

## Versioning

Update the version in `package.json` before publishing:

```bash
npm version patch  # 0.1.0 -> 0.1.1
npm version minor  # 0.1.0 -> 0.2.0
npm version major  # 0.1.0 -> 1.0.0
```

## Installation for Users

After publishing, users can install with:

```bash
npm install @jbride/bitcoinpqc-wasm
```

## Notes

- The WASM files (`bitcoinpqc.js` and `bitcoinpqc.wasm`) must be included in the published package
- The `prepublishOnly` script ensures everything is built before publishing
- Users do NOT need Emscripten to use the published package - only to build from source

