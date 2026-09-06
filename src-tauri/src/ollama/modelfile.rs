//! Modelfile `parameters` parser: extracts per-model sampling defaults.
//!
//! Pure functions with no Tauri/runtime dependency, extracted from
//! `model_service.rs` so the parser is unit-testable in isolation.

use crate::generated_validation::NUM_CTX_RANGE;
use crate::payloads::ModelDefaultParams;

/// Clamp a raw context_length value to the `NUM_CTX_RANGE` bounds and
/// convert to `u32`. Values above the ceiling are capped to the max
/// supported `num_ctx`; values below the floor are raised to the minimum.
/// Malformed (non-numeric) values are filtered out before this is called.
pub(crate) fn clamp_ctx(n: u64) -> Option<u32> {
    let min = NUM_CTX_RANGE.0 as u64;
    let max = NUM_CTX_RANGE.1 as u64;
    let clamped = n.clamp(min, max);
    u32::try_from(clamped).ok()
}

/// Parse a Modelfile's `parameters` string (as returned by Ollama's
/// `/api/show` top-level `parameters` field) into a `ModelDefaultParams`.
///
/// The Ollama `/api/show` response exposes the `parameters` field as a
/// pre-parsed string where each line is `<key><whitespace><value>` (the
/// `PARAMETER` prefix from the Modelfile source is stripped by Ollama).
/// Values may be quoted (e.g. `stop "<|eot_id|>"`). Only the five sampled
/// fields are extracted: `temperature`, `top_p`, `top_k`, `num_ctx`,
/// `num_predict`. Unknown keys, malformed values, blank lines, and quoted
/// string values (used by `stop`) are silently ignored. Returns `None` only
/// when none of the five known keys were successfully parsed (caller treats
/// the whole `default_params` field as absent in that case).
pub(crate) fn parse_modelfile_parameters(raw: &str) -> Option<ModelDefaultParams> {
    let mut temperature: Option<f64> = None;
    let mut top_p: Option<f64> = None;
    let mut top_k: Option<i32> = None;
    let mut num_ctx: Option<u32> = None;
    let mut num_predict: Option<i32> = None;

    for line in raw.lines() {
        let line = line.trim();
        // Each line is `key<whitespace>value`. `split_whitespace` folds
        // runs of spaces/tabs, so `key   value` → ["key", "value"].
        let mut tokens = line.split_whitespace();
        let key = match tokens.next() {
            Some(k) => k,
            None => continue,
        };
        let value = match tokens.next() {
            Some(v) => v,
            None => continue,
        };
        match key {
            "temperature" if temperature.is_none() => {
                temperature = value.parse::<f64>().ok();
            }
            "top_p" if top_p.is_none() => {
                top_p = value.parse::<f64>().ok();
            }
            "top_k" if top_k.is_none() => {
                top_k = value.parse::<i32>().ok();
            }
            "num_ctx" if num_ctx.is_none() => {
                num_ctx = value.parse::<u32>().ok();
            }
            "num_predict" if num_predict.is_none() => {
                // Ollama's Modelfile convention uses `num_predict -1` to mean
                // "unbounded". Our chat validation now accepts `-1` as a
                // valid sentinel, so we pass it through instead of
                // treating it as absent.
                num_predict = value.parse::<i32>().ok();
            }
            _ => {}
        }
    }

    let params = ModelDefaultParams {
        temperature,
        top_p,
        top_k,
        num_ctx,
        num_predict,
    };
    // If nothing parsed, signal absence with `None` so the struct is dropped
    // entirely and clients fall back to DEFAULT_MODEL_PARAMS for every field.
    if params.temperature.is_none()
        && params.top_p.is_none()
        && params.top_k.is_none()
        && params.num_ctx.is_none()
        && params.num_predict.is_none()
    {
        None
    } else {
        Some(params)
    }
}

#[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_ctx_within_range() {
        assert_eq!(clamp_ctx(8192), Some(8192));
    }

    #[test]
    fn clamp_ctx_above_max() {
        assert_eq!(clamp_ctx(4_000_000), Some(NUM_CTX_RANGE.1));
    }

    #[test]
    fn clamp_ctx_below_min() {
        assert_eq!(clamp_ctx(0), Some(NUM_CTX_RANGE.0));
    }

    #[test]
    fn parse_full_modelfile_parameters() {
        // Real Ollama /api/show format: `key<whitespace>value` per line,
        // no PARAMETER prefix.
        let raw = "temperature                    0.8\n\
                   top_p                          0.9\n\
                   top_k                          40\n\
                   num_ctx                        8192\n\
                   num_predict                    -1\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.8));
        assert_eq!(params.top_p, Some(0.9));
        assert_eq!(params.top_k, Some(40));
        assert_eq!(params.num_ctx, Some(8192));
        // `num_predict -1` is Ollama's "unbounded" sentinel, now preserved
        // as-is since chat validation accepts it.
        assert_eq!(params.num_predict, Some(-1));
    }

    #[test]
    fn parse_partial_modelfile_parameters_only_some_keys() {
        let raw = "temperature                    0.5\n\
                   num_predict                    256\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.5));
        assert!(params.top_p.is_none());
        assert!(params.top_k.is_none());
        assert!(params.num_ctx.is_none());
        assert_eq!(params.num_predict, Some(256));
    }

    #[test]
    fn parse_empty_string_returns_none() {
        assert!(parse_modelfile_parameters("").is_none());
    }

    #[test]
    fn parse_only_unknown_keys_returns_none() {
        // Real Ollama format: `stop "<|eot_id|>"` etc. — none of the five
        // tracked keys present → struct dropped entirely.
        let raw = "stop                           \"<|eot_id|>\"\n\
                   repeat_penalty                 1.1\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_ignores_malformed_values() {
        let raw = "temperature                    notanumber\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        // temperature failed to parse → stays None; top_k parsed.
        assert!(params.temperature.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_ignores_non_parameter_lines() {
        // Lines that don't have a known key are ignored (comments, template,
        // etc.). Only the tracked key line survives.
        let raw = "# A Modelfile comment line\n\
                   TEMPLATE passed through\n\
                   temperature                    0.7\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.7));
    }

    #[test]
    fn parse_tolerates_extra_whitespace_between_tokens() {
        // Ollama pads keys to a fixed width; tolerate arbitrary spacing.
        let raw = "temperature    0.9\n\
                   top_k\t64\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.9));
        assert_eq!(params.top_k, Some(64));
    }

    #[test]
    fn parse_first_value_wins_ignore_dupes() {
        let raw = "temperature                    0.5\n\
                   temperature                    0.9\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.5));
    }

    #[test]
    fn parse_quoted_stop_values_are_ignored() {
        // `stop` values are quoted strings that aren't tracked fields —
        // they should be silently ignored, along with unknown keys.
        let raw = "stop                           \"<|eot_id|>\"\n\
                   temperature                    0.7\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(0.7));
    }

    #[test]
    fn parse_negative_num_predict_is_preserved() {
        // `num_predict -1` is Ollama's "unbounded" sentinel, now preserved
        // as `Some(-1)` since chat validation accepts it.
        let raw = "num_predict                    -1\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.num_predict, Some(-1));
    }

    #[test]
    fn parse_rejects_negative_num_ctx() {
        // num_ctx is u32; a negative parse should leave it None. Since no
        // other tracked field is present in this input, the whole struct is
        // dropped (None) per the "nothing parsed" rule.
        let raw = "num_ctx                        -1024\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_rejects_negative_num_ctx_when_other_fields_present() {
        // num_ctx parse failure stays None, but the other tracked field
        // keeps the struct alive.
        let raw = "num_ctx                        -1024\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert!(params.num_ctx.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_negative_num_predict_when_other_fields_present() {
        // `num_predict -1` is preserved as `Some(-1)`, and the other tracked
        // field keeps the struct alive.
        let raw = "num_predict                    -1\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.num_predict, Some(-1));
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_line_missing_value_is_ignored() {
        let raw = "temperature\n\
                   top_k                          40\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert!(params.temperature.is_none());
        assert_eq!(params.top_k, Some(40));
    }

    #[test]
    fn parse_line_missing_key_is_ignored() {
        // A blank or whitespace-only line has no tokens → skipped.
        let raw = "\n\
                   top_p                          0.9\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.top_p, Some(0.9));
    }

    #[test]
    fn parse_real_ollama_response_with_stop_directives() {
        // Simulates a real stock model (e.g. llama3.2) that only has `stop`
        // directives and no tracked sampling fields → returns None.
        let raw = "stop                           \"<|start_header_id|>\"\n\
                   stop                           \"<|end_header_id|>\"\n\
                   stop                           \"<|eot_id|>\"\n";
        assert!(parse_modelfile_parameters(raw).is_none());
    }

    #[test]
    fn parse_real_ollama_response_with_sampling_params() {
        // Simulates a custom model with sampling params alongside stop
        // directives (e.g. the `UncensoredAi/diddy` model).
        let raw = "stop                           \"<|im_end|>\"\n\
                   num_ctx                        4096\n\
                   temperature                    1.1\n\
                   top_p                          0.95\n";
        let params = parse_modelfile_parameters(raw).expect("expected Some");
        assert_eq!(params.temperature, Some(1.1));
        assert_eq!(params.top_p, Some(0.95));
        assert_eq!(params.num_ctx, Some(4096));
        assert!(params.top_k.is_none());
        assert!(params.num_predict.is_none());
    }
}
