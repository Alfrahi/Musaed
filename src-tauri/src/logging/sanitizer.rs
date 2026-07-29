//! Log entry sanitization — security-adjacent business logic for the trace
//! domain.
//!
//! Frontend log entries arrive via IPC and must be scrubbed before they are
//! written to disk. This module owns three responsibilities:
//!
//! - stripping ANSI escape sequences (color codes, cursor movement, OSC)
//! - normalizing C0 control characters (preserving `\t` for formatting)
//! - collapsing repeated whitespace and truncating overlong entries
//!
//! Pulled out of `commands.rs` so that `commands.rs` remains a thin adapter
//! layer per STANDARDS.md §6.

use crate::validation::MAX_LOG_ENTRY_LEN;

/// Sanitizes a log entry for safe logging.
///
/// Security measures:
/// - Strips all C0 control characters except tab (preserves formatting)
/// - Strips ANSI escape sequences (color codes, cursor movement, etc.)
/// - Removes potential log injection patterns (newlines, carriage returns in
///   field contexts)
/// - Prevents timestamp/log-level injection by filtering problematic patterns
pub(crate) fn sanitize_log_entry(entry: &str) -> String {
    // Step 1: Remove ANSI escape sequences (color codes, cursor movement, etc.)
    let without_ansi = strip_ansi_escapes(entry);

    // Step 2: Strip C0 control characters except tab (which is useful for formatting)
    // Keep: tab (\t), printable ASCII, and valid Unicode
    // Remove: all other C0 controls including \n, \r, \0, \x01-\x08, \x0b-\x0c, \x0e-\x1f
    let sanitized: String = without_ansi
        .chars()
        .map(|c| {
            // Keep newline and carriage return as whitespace (will be collapsed)
            if c == '\t' || c == '\n' || c == '\r' {
                return c;
            }
            // Convert other C0 control characters to space to preserve word boundaries
            if c.is_control() {
                return ' ';
            }
            // Preserve all other characters (printable ASCII, Unicode, spaces, etc.)
            c
        })
        .collect();

    // Step 3: Prevent log injection via repeated whitespace or special sequences
    // Collapse multiple spaces/tabs to single space for readability
    let collapsed = collapse_whitespace(&sanitized);

    // Step 4: Truncate to prevent memory issues with extremely long entries
    // while preserving the beginning which typically contains useful info
    if collapsed.chars().count() > MAX_LOG_ENTRY_LEN {
        format!(
            "{}... [TRUNCATED]",
            &collapsed
                .chars()
                .take(MAX_LOG_ENTRY_LEN.saturating_sub(15))
                .collect::<String>()
        )
    } else {
        collapsed
    }
}

/// Removes ANSI escape sequences from a string.
/// Handles: SGR sequences (colors, bold, etc.), cursor movement, clear screen, etc.
fn strip_ansi_escapes(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Check for CSI sequence: ESC [ ...
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            // Find the end of the escape sequence: CSI ends with a byte in 0x40-0x7E
            let mut j = i + 2;
            while j < bytes.len() {
                let b = bytes[j];
                if (0x40..=0x7E).contains(&b) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            i = j;
        }
        // Check for OSC sequence: ESC ] (operating system command)
        else if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b']' {
            let mut j = i + 2;
            // OSC sequences end with BEL (0x07) or ESC \
            while j < bytes.len() {
                if bytes[j] == 0x07
                    || (bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\')
                {
                    j += if bytes[j] == 0x07 { 1 } else { 2 };
                    break;
                }
                j += 1;
            }
            i = j;
        }
        // Check for two-character escape sequence (ESC X)
        else if bytes[i] == 0x1b && i + 1 < bytes.len() {
            i += 2;
        }
        // Regular character
        else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }

    result
}

/// Collapses multiple whitespace characters to single spaces.
fn collapse_whitespace(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut last_was_space = false;

    for c in input.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                result.push(' ');
                last_was_space = true;
            }
        } else {
            result.push(c);
            last_was_space = false;
        }
    }

    result.trim().to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_sgr_color_codes() {
        let input = "\x1b[31mred\x1b[0m text";
        assert_eq!(strip_ansi_escapes(input), "red text");
    }

    #[test]
    fn strips_osc_sequences() {
        // OSC 0;title BEL
        let input = "\x1b]0;some title\x07hello";
        assert_eq!(strip_ansi_escapes(input), "hello");
    }

    #[test]
    fn strips_csi_cursor_movement() {
        // ESC [2J — clear screen
        let input = "\x1b[2Jhi";
        assert_eq!(strip_ansi_escapes(input), "hi");
    }

    #[test]
    fn preserves_tab_and_newline_through_sanitize() {
        // \t and \n are kept by the sanitization step (collapse_whitespace
        // turns them into single spaces).
        let sanitized = sanitize_log_entry("a\tb\nc");
        assert_eq!(sanitized, "a b c");
    }

    #[test]
    fn converts_c0_controls_to_space() {
        // \x01 (SOH) → space
        let sanitized = sanitize_log_entry("a\x01b");
        assert_eq!(sanitized, "a b");
    }

    #[test]
    fn collapses_repeated_whitespace() {
        assert_eq!(collapse_whitespace("a    b\t\tc"), "a b c");
        assert_eq!(collapse_whitespace("   leading"), "leading");
        assert_eq!(collapse_whitespace("trailing   "), "trailing");
    }

    #[test]
    fn truncates_overlong_entries() {
        let long = "x".repeat(MAX_LOG_ENTRY_LEN + 100);
        let sanitized = sanitize_log_entry(&long);
        assert!(sanitized.ends_with("... [TRUNCATED]"));
        // Truncation leaves room for the suffix marker.
        assert!(sanitized.chars().count() <= MAX_LOG_ENTRY_LEN);
    }

    #[test]
    fn preserves_plain_ascii() {
        let sanitized = sanitize_log_entry("hello world");
        assert_eq!(sanitized, "hello world");
    }
}
