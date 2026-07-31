#!/usr/bin/env node
"use strict";

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const FEATURES_DIR = join(PROJECT_ROOT, "apps/web/src/features");
const STORE_DIR = join(PROJECT_ROOT, "apps/web/src/store");
const IPC_TS = join(PROJECT_ROOT, "apps/web/src/lib/ipc.ts");

/**
 * Extract stateSchemas from a feature manifest file.
 * @param {string} filePath - Path to the feature manifest file.
 * @returns {Record<string, number>} - stateSchemas object.
 */
function extractStateSchemas(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/stateSchemas:\s*({[\s\S]+?})\s*(,|\n|$)/);
  if (!match) return {};
  
  // Parse the stateSchemas object
  const schemas = {};
  // Extract key-value pairs using a more robust regex
  const pairMatches = match[1].matchAll(/(\w+)\s*:\s*(\d+)/g);
  
  for (const pairMatch of pairMatches) {
    const key = pairMatch[1];
    const value = parseInt(pairMatch[2], 10);
    schemas[key] = value;
  }
  
  return schemas;
}

/**
 * Extract persistenceSchemas from a feature manifest file.
 * @param {string} filePath - Path to the feature manifest file.
 * @returns {Record<string, string>} - persistenceSchemas object.
 */
function extractPersistenceSchemas(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/persistenceSchemas:\s*({[\s\S]+?})\s*(,|\n|$)/);
  if (!match) return {};
  
  // Parse the persistenceSchemas object
  const schemas = {};
  // Extract key-value pairs using a more robust regex
  const pairMatches = match[1].matchAll(/(\w+)\s*:\s*["']([^"']+)["']/g);
  
  for (const pairMatch of pairMatches) {
    const key = pairMatch[1];
    const value = pairMatch[2];
    schemas[key] = value;
  }
  
  return schemas;
}

/**
 * Extract publicApi.hooks and publicApi.components from a feature manifest file.
 * @param {string} filePath - Path to the feature manifest file.
 * @returns {{ hooks: string[], components: string[], utils: string[] }} - publicApi hooks, components, and utils.
 */
function extractPublicApi(filePath) {
  const content = readFileSync(filePath, "utf-8");

  // Extract hooks - match only the array content between [ and ]
  const hooksMatch = content.match(/publicApi:\s*{\s*hooks:\s*\[([^\]]*)\]/);
  let hooks = [];
  if (hooksMatch) {
    hooks = hooksMatch[1].split(",")
      .map(s => s.trim().replace(/["'\s]/g, ""))
      .filter(s => s.length > 0 && !s.startsWith("//"));
  }

  // Extract components - match only the array content between [ and ]
  const componentsMatch = content.match(/publicApi:\s*{\s*[^}]*components:\s*\[([^\]]*)\]/);
  let components = [];
  if (componentsMatch) {
    components = componentsMatch[1].split(",")
      .map(s => s.trim().replace(/["'\s]/g, ""))
      .filter(s => s.length > 0 && !s.startsWith("//"));
  }

  // Extract utils - match only the array content between [ and ]
  const utilsMatch = content.match(/publicApi:\s*{\s*[^}]*utils:\s*\[([^\]]*)\]/);
  let utils = [];
  if (utilsMatch) {
    utils = utilsMatch[1].split(",")
      .map(s => s.trim().replace(/["'\s]/g, ""))
      .filter(s => s.length > 0 && !s.startsWith("//"));
  }

  return { hooks, components, utils };
}

/**
 * Extract the store version from a store file.
 * @param {string} filePath - Path to the store file.
 * @returns {number} - The store version.
 */
function extractStoreVersion(filePath) {
  const content = readFileSync(filePath, "utf-8");
  
  // First try to find version in persist config
  let versionMatch = content.match(/version:\s*(\d+)/);
  if (versionMatch) {
    return parseInt(versionMatch[1], 10);
  }
  
  // Then try to find a constant like RAG_STORE_VERSION
  versionMatch = content.match(/const\s+[A-Z_]+VERSION\s*=\s*(\d+)/);
  if (versionMatch) {
    return parseInt(versionMatch[1], 10);
  }
  
  return null;
}

/**
 * Extract the store name from a store file.
 * @param {string} filePath - Path to the store file.
 * @returns {string} - The store name.
 */
function extractStoreName(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
  return nameMatch ? nameMatch[1] : null;
}

/**
 * Extract exports from an index.ts file.
 * @param {string} filePath - Path to the index.ts file.
 * @returns {{ hooks: string[], components: string[] }} - Exported hooks and components.
 */
function extractExports(filePath) {
  const content = readFileSync(filePath, "utf-8");
  
  const hooks = [];
  const components = [];
  
  // Extract re-exports from store files (e.g., conversation-store, message-store, etc.)
  const storeExports = content.match(/export\s+{\s*([^}]+)\s*}\s+from\s+["']@\/store\/[^"']+["']/g);
  if (storeExports) {
    for (const exportLine of storeExports) {
      const exportedItems = exportLine.match(/{\s*([^}]+)\s*}/)[1].split(",").map(s => s.trim());
      hooks.push(...exportedItems);
    }
  }
  
  // Extract direct exports from hooks
  const hookExports = content.match(/export\s+{\s*([^}]+)\s*}\s+from\s+["']\.\/hooks\/[^"']+["']/g);
  if (hookExports) {
    for (const exportLine of hookExports) {
      const exportedItems = exportLine.match(/{\s*([^}]+)\s*}/)[1].split(",").map(s => s.trim());
      hooks.push(...exportedItems);
    }
  }
  
  // Extract direct exports from utils
  const utilExports = content.match(/export\s+{\s*([^}]+)\s*}\s+from\s+["']\.\/utils\/[^"']+["']/g);
  if (utilExports) {
    for (const exportLine of utilExports) {
      const exportedItems = exportLine.match(/{\s*([^}]+)\s*}/)[1].split(",").map(s => s.trim());
      hooks.push(...exportedItems);
    }
  }
  
  // Extract direct exports from components - handle both named and default exports
  const componentExports = content.match(/export\s+{\s*([^}]+)\s*}\s+from\s+["']\.\/components["']/g);
  if (componentExports) {
    for (const exportLine of componentExports) {
      const exportedItems = exportLine.match(/{\s*([^}]+)\s*}/)[1].split(",").map(s => s.trim().replace(/^default\s+as\s+/, ""));
      components.push(...exportedItems);
    }
  }
  
  // Extract default exports from components (e.g., export { default as Component } from './components/Component')
  const defaultComponentExports = content.match(/export\s+{\s*default\s+as\s+(\w+)\s*}\s+from\s+["']\.\/components\/[^"']+["']/g);
  if (defaultComponentExports) {
    for (const exportLine of defaultComponentExports) {
      const exportedItem = exportLine.match(/default\s+as\s+(\w+)/)[1];
      components.push(exportedItem);
    }
  }
  
  // Extract named exports from component files (e.g., export { ProjectList } from './components/ProjectList')
  const namedComponentExports = content.matchAll(/export\s+\{\s*([^}]+)\s*\}\s+from\s+["']\.\/components\/[^"']+["']/g);
  for (const exportLine of namedComponentExports) {
    const exportedItems = exportLine[1].split(",").map(s => s.trim())
      // Filter out type exports
      .filter(s => !s.startsWith("type "));
    for (const item of exportedItems) {
      const cleaned = item.replace(/^type\s+/, "").trim();
      if (cleaned && !components.includes(cleaned)) {
        components.push(cleaned);
      }
    }
  }
  
  // Extract direct function/class exports
  const directExports = content.match(/export\s+(?:function|const|class)\s+(\w+)/g);
  if (directExports) {
    for (const exportLine of directExports) {
      const exportedItem = exportLine.match(/export\s+(?:function|const|class)\s+(\w+)/)[1];
      hooks.push(exportedItem);
    }
  }
  
  // Extract default exports from feature.manifest
  const manifestExport = content.match(/export\s+{\s*default\s+as\s+default\s*}\s+from\s+["']\.\/feature\.manifest["']/);
  if (manifestExport) {
    hooks.push("default");
  }
  
  return { hooks, components };
}

/**
 * Extract ipcEndpoints from a feature manifest file.
 * @param {string} filePath - Path to the feature manifest file.
 * @returns {string[]} - ipcEndpoints array.
 */
function extractIpcEndpoints(filePath) {
  const content = readFileSync(filePath, "utf-8");
  // Strip comments before parsing so inline `// TODO` notes between
  // endpoints don't merge with the next entry and get filtered together.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const match = stripped.match(/ipcEndpoints:\s*\[([^\]]*)\]/);
  if (!match) return [];
  const inner = match[1].trim();
  if (inner === '') return [];
  const endpoints = [];
  for (const part of inner.split(',')) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const strMatch = cleaned.match(/['"]([^'"]+)['"]/);
    if (strMatch) endpoints.push(strMatch[1]);
  }
  return endpoints;
}

/**
 * Check if a feature manifest has failureModes defined.
 * @param {string} filePath - Path to the feature manifest file.
 * @returns {boolean} - Whether failureModes is present.
 */
function hasFailureModes(filePath) {
  const content = readFileSync(filePath, "utf-8");
  return /failureModes\s*:\s*\{/.test(content);
}

/**
 * Parse ipc.ts and build a map of `NamespaceApi.method` → Set<`cmd_xxx`>.
 *
 * The IPC layer exports typed API namespaces (ragApi, chatApi, ollamaApi, etc.)
 * whose methods delegate to `callInternal('cmd_xxx', ...)`. A single method
 * may invoke multiple commands (e.g. `logApi.clear` calls both
 * `cmd_logs_request_clear_token` and `cmd_logs_clear`), so the value is a
 * Set rather than a single string.
 *
 * @returns {Map<string, Set<string>>} - Map of `"namespaceApi.method"` → `Set<cmd_xxx>`.
 */
function parseIpcNamespaceToCommandMap() {
  const content = readFileSync(IPC_TS, "utf-8");
  const map = new Map();

  // Match: export const <name>Api = { ... }
  const namespaceRegex = /export\s+const\s+(\w+Api)\s*=\s*\{/g;
  let nsMatch;
  while ((nsMatch = namespaceRegex.exec(content)) !== null) {
    const nsName = nsMatch[1];
    const nsBodyStart = nsMatch.index + nsMatch[0].length;
    // Find the matching closing brace for this object
    let depth = 1;
    let nsBodyEnd = nsBodyStart;
    for (let i = nsBodyStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) { nsBodyEnd = i; break; }
      }
    }
    const nsBody = content.substring(nsBodyStart, nsBodyEnd);

    // Walk the namespace body. Track the current method name (set by a
    // method-signature pattern at start-of-line) and map every callInternal
    // invocation to it. This correctly handles methods that invoke multiple
    // commands (e.g. logApi.clear → request_clear_token + clear) and avoids
    // capturing words from JSDoc comments, option-object keys, or the
    // `callInternal` token itself when it wraps to start-of-line.
    const methodSigRegex = /(?:^|\n)\s*([a-zA-Z_$][\w$]*)\s*[:(]/g;
    const callInternalRegex = /callInternal\(\s*['"]([^'"]+)['"]/g;
    const RESERVED = new Set(["callInternal", "if", "return", "const", "let", "var", "async", "await", "new", "function", "export"]);
    const sigPositions = [];
    let sigMatch;
    while ((sigMatch = methodSigRegex.exec(nsBody)) !== null) {
      if (RESERVED.has(sigMatch[1])) continue;
      sigPositions.push({ name: sigMatch[1], pos: sigMatch.index });
    }
    let callMatch;
    while ((callMatch = callInternalRegex.exec(nsBody)) !== null) {
      const callPos = callMatch.index;
      let methodName = null;
      for (let i = sigPositions.length - 1; i >= 0; i--) {
        if (sigPositions[i].pos <= callPos) {
          methodName = sigPositions[i].name;
          break;
        }
      }
      if (methodName) {
        const key = `${nsName}.${methodName}`;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(callMatch[1]);
      }
    }
  }
  return map;
}

/**
 * Scan all .ts/.tsx files in a feature directory for IPC namespace API usage
 * and return the set of `cmd_xxx` commands actually invoked.
 *
 * @param {string} featureDir - Path to the feature root directory.
 * @param {Map<string, Set<string>>} nsToCmd - Map from parseIpcNamespaceToCommandMap().
 * @returns {Set<string>} - Set of `cmd_xxx` names found in feature source.
 */
function scanFeatureIpcUsage(featureDir, nsToCmd) {
  const used = new Set();
  // Build a regex that matches any `namespaceApi.method` call.
  const patterns = [];
  for (const [nsKey] of nsToCmd) {
    const [ns, method] = nsKey.split('.');
    patterns.push(`${ns}\\.${method}\\b`);
  }
  const combined = new RegExp(patterns.join('|'), 'g');

  function walkDir(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const raw = readFileSync(full, 'utf-8');
        // Strip comments so JSDoc mentions like `traceApi.append` in
        // `* and the underlying trace record persisted via \`traceApi.append\``
        // don't register as real calls.
        const content = raw
          .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
          .replace(/\/\/[^\n]*/g, '');        // line comments
        let match;
        while ((match = combined.exec(content)) !== null) {
          const nsKey = match[0];
          const cmds = nsToCmd.get(nsKey);
          if (cmds) for (const cmd of cmds) used.add(cmd);
        }
      }
    }
  }
  walkDir(featureDir);
  return used;
}

/**
 * Check IPC endpoint drift between a feature's manifest and its actual source.
 *
 * Reports two kinds of drift:
 *  1. Manifest declares an endpoint the feature source never calls.
 *  2. Feature source calls an endpoint not listed in the manifest.
 *
 * @param {string} feature - Feature name.
 * @param {string} manifestPath - Path to feature.manifest.ts.
 * @param {string} featureDir - Path to the feature directory.
 * @param {Map<string, string>} nsToCmd - Map from parseIpcNamespaceToCommandMap().
 * @returns {boolean} - True if any drift was found.
 */
function checkIpcEndpointDrift(feature, manifestPath, featureDir, nsToCmd) {
  const declared = new Set(extractIpcEndpoints(manifestPath));
  const actual = scanFeatureIpcUsage(featureDir, nsToCmd);
  let drift = false;
  for (const cmd of declared) {
    if (!actual.has(cmd)) {
      console.error(`  ❌ IPC drift: manifest of ${feature} declares '${cmd}' but source never calls it.`);
      drift = true;
    }
  }
  for (const cmd of actual) {
    if (!declared.has(cmd)) {
      console.error(`  ❌ IPC drift: feature ${feature} calls '${cmd}' but manifest does not declare it.`);
      drift = true;
    }
  }
  return drift;
}

/**
 * Validate all feature manifests against their corresponding stores and exports.
 */
function validateManifests() {
  const nsToCmd = parseIpcNamespaceToCommandMap();
  const featureDirs = readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  let hasErrors = false;
  
  for (const feature of featureDirs) {
    const manifestPath = join(FEATURES_DIR, feature, "feature.manifest.ts");
    const indexPath = join(FEATURES_DIR, feature, "index.ts");
    
    if (!readFileSync(manifestPath, "utf-8")) continue;
    
    console.log(`\nValidating feature: ${feature}`);
    
    // Extract manifest data
    const stateSchemas = extractStateSchemas(manifestPath);
    const persistenceSchemas = extractPersistenceSchemas(manifestPath);
    const { hooks: manifestHooks, components: manifestComponents, utils: manifestUtils } = extractPublicApi(manifestPath);
    
    // Validate stateSchemas
    for (const [storeKey, expectedVersion] of Object.entries(stateSchemas)) {
      // Handle special cases
      let storeFileName;
      if (storeKey === "modelStore") {
        storeFileName = "model-store.ts";
      } else if (storeKey === "messageStore") {
        // messageStore is handled by Rust backend, skip version check
        console.log(`  ⚠️  ${storeKey} is handled by Rust backend, skipping version check`);
        continue;
      } else {
        storeFileName = `${storeKey.replace(/Store$/, "-store")}.ts`;
      }
      
      const storePath = join(STORE_DIR, storeFileName);
      
      try {
        const content = readFileSync(storePath, "utf-8");
        const actualVersion = extractStoreVersion(storePath);
        if (actualVersion === null) {
          console.error(`  ❌ Could not extract version from store: ${storeFileName}`);
          hasErrors = true;
          continue;
        }

        if (actualVersion !== expectedVersion) {
          console.error(`  ❌ Version mismatch for ${storeKey}: manifest declares ${expectedVersion}, store has ${actualVersion}`);
          hasErrors = true;
        } else {
          console.log(`  ✅ Version match for ${storeKey}: ${expectedVersion}`);
        }
      } catch (err) {
        console.error(`  ❌ Store file not found: ${storeFileName}`);
        hasErrors = true;
        continue;
      }
    }
    
    // Validate persistenceSchemas
    for (const [schemaKey, expectedName] of Object.entries(persistenceSchemas)) {
      let storeFileName;
      if (schemaKey === "conversation" || schemaKey === "conversations") {
        storeFileName = "conversation-store.ts";
      } else if (schemaKey === "settings") {
        storeFileName = "settings-store.ts";
      } else if (schemaKey === "message" || schemaKey === "messages") {
        // Skip message store as it's handled by Rust backend
        console.log(`  ⚠️  Persistence for ${schemaKey} is handled by Rust backend (in-memory cache only)`);
        continue;
      } else if (schemaKey === "rag") {
        storeFileName = "rag-store.ts";
      } else if (schemaKey === "models") {
        storeFileName = "model-store.ts";
      } else {
        storeFileName = `${schemaKey.replace(/([A-Z])/g, "-$1").toLowerCase()}-store.ts`;
      }
      
      const storePath = join(STORE_DIR, storeFileName);
      
      try {
        const content = readFileSync(storePath, "utf-8");
        const actualName = extractStoreName(storePath);
        if (actualName === null) {
          console.error(`  ❌ Could not extract name from store: ${storeFileName}`);
          hasErrors = true;
          continue;
        }

        if (actualName !== expectedName) {
          console.error(`  ❌ Name mismatch for ${schemaKey}: manifest declares '${expectedName}', store has '${actualName}'`);
          hasErrors = true;
        } else {
          console.log(`  ✅ Name match for ${schemaKey}: ${expectedName}`);
        }
      } catch (err) {
        console.error(`  ❌ Store file not found for persistence schema: ${storeFileName}`);
        hasErrors = true;
        continue;
      }
    }
    
    // Validate publicApi (hooks and components)
    if (readFileSync(indexPath, "utf-8")) {
      const { hooks: exportedHooks, components: exportedComponents } = extractExports(indexPath);
      
      // Check hooks
      for (const hook of manifestHooks) {
        if (!exportedHooks.includes(hook)) {
          console.error(`  ❌ Hook '${hook}' declared in manifest but not exported in index.ts`);
          hasErrors = true;
        } else {
          console.log(`  ✅ Hook '${hook}' is exported`);
        }
      }
      
      // Check components
      for (const component of manifestComponents) {
        if (!exportedComponents.includes(component)) {
          console.error(`  ❌ Component '${component}' declared in manifest but not exported in index.ts`);
          hasErrors = true;
        } else {
          console.log(`  ✅ Component '${component}' is exported`);
        }
      }
      
      // Check utils (they might be mistakenly listed as components)
      for (const util of manifestUtils) {
        if (!exportedHooks.includes(util)) {
          console.error(`  ❌ Util '${util}' declared in manifest but not exported in index.ts`);
          hasErrors = true;
        } else {
          console.log(`  ✅ Util '${util}' is exported`);
        }
      }
    }

    // ── failureModes warning (STANDARDS.md §13) ──
    const ipcEndpoints = extractIpcEndpoints(manifestPath);
    if (ipcEndpoints.length > 0 && !hasFailureModes(manifestPath)) {
      console.warn("  ⚠️  Feature '" + feature + "' has " + ipcEndpoints.length + " IPC endpoint(s) but no failureModes defined.");
      console.warn("     See STANDARDS.md §13 — each feature SHOULD document failure modes.");
    }

    // ── IPC endpoint drift check ──
    if (checkIpcEndpointDrift(feature, manifestPath, join(FEATURES_DIR, feature), nsToCmd)) {
      hasErrors = true;
    }
  }
  
  if (hasErrors) {
    console.error("\n❌ Validation failed. See errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ All validations passed.");
  }
}

validateManifests();