//! Build script for Tauri and TypeScript type generation.

fn main() {
    // Run Tauri build
    tauri_build::build();

    // Re-run build script if any Rust files in src-tauri/src change
    println!("cargo:rerun-if-changed=src");

    // Generate placeholder for TypeScript types
    // Specta type generation will be implemented after API finalization
    std::fs::write(
        "../packages/contracts/src/generated/specta-types.ts",
        "// TypeScript types will be generated from Rust using specta\n// Implementation in progress...",
    ).expect("Failed to write placeholder file");
}
