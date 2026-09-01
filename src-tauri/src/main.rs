#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if musaed_lib::run().is_err() {
        // Error already logged to the log pipeline and stderr by `run`.
        std::process::exit(1);
    }
}
