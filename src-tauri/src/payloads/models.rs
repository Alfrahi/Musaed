use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size: Option<u64>,
    pub digest: Option<String>,
    pub details: Option<OllamaModelDetails>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModelDetails {
    pub format: Option<String>,
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealth {
    pub is_running: bool,
    pub version: Option<String>,
    pub response_time_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidation {
    pub is_valid: bool,
    pub model_name: String,
    pub details: Option<OllamaModelDetails>,
    /// The model's maximum context window, parsed from the `/api/show`
    /// response's `model_info` map. The key is architecture-prefixed
    /// (e.g. `llama.context_length`, `qwen2.context_length`), so the value
    /// is extracted by scanning for any key ending in `.context_length`.
    /// `None` when the field is absent or unsupported by the model.
    pub context_length: Option<u32>,
    /// Per-model sampling defaults parsed from the Modelfile's `PARAMETER`
    /// directives (the top-level `parameters` string returned by
    /// `/api/show`). Each field is `None` when the corresponding
    /// `PARAMETER` directive is absent from the Modelfile or malformed.
    /// `None` on the outer field indicates the `parameters` string was
    /// absent or unparseable in its entirety.
    pub default_params: Option<ModelDefaultParams>,
}

/// Per-model sampling defaults parsed from a Modelfile's `PARAMETER`
/// directives. Mirrors `ModelDefaultParamsSchema` in
/// `packages/contracts/src/schemas/ollama.ts` — keep both sides in
/// lockstep; `pnpm validate:contracts --strict` cross-checks the
/// `ModelValidation` return type end-to-end.
#[derive(Debug, Serialize, Deserialize, Clone, Type, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefaultParams {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub top_k: Option<i32>,
    pub num_ctx: Option<u32>,
    pub num_predict: Option<i32>,
}
