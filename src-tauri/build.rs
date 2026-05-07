fn main() {
    // Re-export the rustc target triple so runtime code can find sidecar binaries
    // by name: `<bin>-<target>` — e.g. `yt-dlp-aarch64-apple-darwin`.
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TARGET={}", target);
    }
    tauri_build::build()
}
