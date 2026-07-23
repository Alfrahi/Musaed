#!/usr/bin/env node
"use strict";

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const FEATURES_DIR = join(PROJECT_ROOT, "apps/web/src/features");
const STORE_DIR = join(PROJECT_ROOT, "apps/web/src/store");

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
 * Validate all feature manifests against their corresponding stores and exports.
 */
function validateManifests() {
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
  }
  
  if (hasErrors) {
    console.error("\n❌ Validation failed. See errors above.");
    process.exit(1);
  } else {
    console.log("\n✅ All validations passed.");
  }
}

validateManifests();