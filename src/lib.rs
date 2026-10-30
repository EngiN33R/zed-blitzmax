use zed::serde_json::{json, Value};
use zed::settings::LspSettings;
use zed_extension_api as zed;

struct BlitzMaxExtension;

const TOOLS_VERSION: &str = "0.1.0";
const TOOLS_FILES: [&str; 3] = ["blitzmax-dap.mjs", "blitzmax-lsp.mjs", "protocol.mjs"];

fn extension_setting<'a>(settings: &'a LspSettings, key: &str) -> Option<&'a Value> {
    [&settings.initialization_options, &settings.settings]
        .into_iter()
        .filter_map(|value| value.as_ref())
        .find_map(|value| value.get("blitzmax")?.get(key))
}

fn tools_override(settings: &LspSettings, env: &[(String, String)]) -> Option<String> {
    extension_setting(settings, "toolsPath")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            env.iter()
                .find(|(key, value)| {
                    key.eq_ignore_ascii_case("BLITZMAX_TOOLS_PATH") && !value.is_empty()
                })
                .map(|(_, value)| value.clone())
        })
}

fn tool_script(directory: &str, name: &str) -> String {
    format!("{}/{name}", directory.trim_end_matches(['/', '\\']))
}

fn tools_manifest_matches(text: &str) -> bool {
    zed::serde_json::from_str::<Value>(text)
        .ok()
        .is_some_and(|value| value["name"] == "blitzmax-tools" && value["version"] == TOOLS_VERSION)
}

fn cached_tools_are_valid(directory: &std::path::Path) -> bool {
    TOOLS_FILES
        .iter()
        .all(|file| directory.join(file).is_file())
        && std::fs::read_to_string(directory.join("package.json"))
            .is_ok_and(|text| tools_manifest_matches(&text))
}

fn tools_directory(settings: &LspSettings, worktree: &zed::Worktree) -> zed::Result<String> {
    // Explicit host paths are passed to Node. Do not inspect them through WASI.
    if let Some(path) = tools_override(settings, &worktree.shell_env()) {
        return Ok(path);
    }
    // All standard-library filesystem access stays inside Zed's work directory.
    let directory = format!("blitzmax-tools-v{TOOLS_VERSION}");
    let path = std::path::Path::new(&directory);
    if !cached_tools_are_valid(path) {
        let url = format!("https://github.com/EngiN33R/zed-blitzmax/releases/download/tools-v{TOOLS_VERSION}/blitzmax-tools-v{TOOLS_VERSION}.tar.gz");
        zed::download_file(&url, &directory, zed::DownloadedFileType::GzipTar)
            .map_err(|error| format!("Cannot download BlitzMax tools {TOOLS_VERSION}: {error}. Set lsp.blitzmax.initialization_options.blitzmax.toolsPath to an installed tools directory, or set BLITZMAX_TOOLS_PATH."))?;
        if !cached_tools_are_valid(path) {
            return Err(
                "The downloaded BlitzMax tools bundle is incomplete or has the wrong version"
                    .into(),
            );
        }
    }
    Ok(std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join(path)
        .to_string_lossy()
        .into_owned())
}

fn node_command(worktree: &zed::Worktree) -> zed::Result<String> {
    worktree
        .which("node")
        .map(Ok)
        .unwrap_or_else(zed::node_binary_path)
}

fn remove_extension_options(value: &mut Value) {
    if let Some(options) = value.get_mut("blitzmax").and_then(Value::as_object_mut) {
        options.remove("serverPath");
        options.remove("serverArguments");
        options.remove("toolsPath");
        options.remove("useCompatibilityBridge");
    }
}

fn parent(path: &str) -> Option<&str> {
    path.trim_end_matches(['/', '\\'])
        .rsplit_once(['/', '\\'])
        .map(|(p, _)| p)
}

fn sdk_from_binary(path: &str) -> Option<String> {
    let bin = parent(path)?;
    let name = bin.rsplit(['/', '\\']).next()?;
    name.eq_ignore_ascii_case("bin")
        .then(|| parent(bin).map(str::to_owned))
        .flatten()
}

fn sdk_setting(settings: &LspSettings) -> Option<String> {
    [&settings.initialization_options, &settings.settings]
        .into_iter()
        .filter_map(|value| value.as_ref())
        .find_map(|value| value.pointer("/blitzmax/sdkPath").and_then(Value::as_str))
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
}

fn server_setting(settings: &LspSettings) -> zed::Result<Option<String>> {
    extension_setting(settings, "serverPath")
        .map(|value| {
            value
                .as_str()
                .filter(|path| !path.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| "blitzmax.serverPath must be a non-empty executable path".into())
        })
        .transpose()
}

fn server_arguments(settings: &LspSettings) -> zed::Result<Vec<String>> {
    match extension_setting(settings, "serverArguments") {
        None => Ok(Vec::new()),
        Some(value) => value
            .as_array()
            .ok_or_else(|| "blitzmax.serverArguments must be an array of strings".to_owned())?
            .iter()
            .map(|argument| {
                argument
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "blitzmax.serverArguments must be an array of strings".into())
            })
            .collect(),
    }
}
fn sdk_and_server(
    settings: &LspSettings,
    worktree: &zed::Worktree,
) -> zed::Result<(String, Option<String>)> {
    let explicit_sdk = sdk_setting(settings);
    // Zed handles binary.path before calling this extension. serverPath selects
    // the underlying server while retaining the extension's bridge/downloader.
    if let Some(path) = server_setting(settings)? {
        let command = worktree.which(&path).unwrap_or(path);
        let sdk = explicit_sdk.or_else(|| sdk_from_binary(&command));
        return Ok((command, sdk));
    }
    let exe = if zed::current_platform().0 == zed::Os::Windows {
        "bls.exe"
    } else {
        "bls"
    };
    if let Some(sdk) = explicit_sdk {
        return Ok((
            format!("{}/bin/{exe}", sdk.trim_end_matches(['/', '\\'])),
            Some(sdk),
        ));
    }
    // Check candidates through the host, not WASI's isolated filesystem.
    let env = worktree.shell_env();
    let env_sdk = settings
        .binary
        .as_ref()
        .and_then(|binary| binary.env.as_ref())
        .and_then(|env| env.get("BMXPATH").cloned())
        .or_else(|| {
            env.iter()
                .find(|(key, _)| key.eq_ignore_ascii_case("BMXPATH"))
                .map(|(_, value)| value.clone())
        });
    if let Some(sdk) = env_sdk {
        let candidate = format!("{}/bin/{exe}", sdk.trim_end_matches(['/', '\\']));
        if let Some(command) = worktree.which(&candidate) {
            return Ok((command, Some(sdk)));
        }
    }
    if let Some(bmk) = worktree.which("bmk") {
        if let Some(sdk) = sdk_from_binary(&bmk) {
            if let Some(command) = worktree.which(&format!("{sdk}/bin/{exe}")) {
                return Ok((command, Some(sdk)));
            }
        }
    }
    if let Some(command) = worktree.which("bls") {
        let sdk = sdk_from_binary(&command);
        return Ok((command, sdk));
    }
    Err("BlitzMax language server not found. Install BlitzMax NG with bin/bls, set lsp.blitzmax.initialization_options.blitzmax.sdkPath to its SDK root, or set lsp.blitzmax.initialization_options.blitzmax.serverPath. See README.md.".into())
}

fn options(settings: &LspSettings, sdk: Option<String>) -> Value {
    let mut options = settings
        .initialization_options
        .clone()
        .unwrap_or_else(|| json!({}));
    if !options.is_object() {
        options = json!({});
    }
    if !options.get("blitzmax").is_some_and(Value::is_object) {
        options["blitzmax"] = json!({});
    }
    if let Some(sdk) = sdk {
        if options["blitzmax"].get("sdkPath").is_none() {
            options["blitzmax"]["sdkPath"] = json!(sdk);
        }
    }
    remove_extension_options(&mut options);
    options
}

impl zed::Extension for BlitzMaxExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let settings = LspSettings::for_worktree("blitzmax", worktree)?;
        let (command, sdk) = sdk_and_server(&settings, worktree)?;
        let mut env: Vec<(String, String)> = settings
            .binary
            .as_ref()
            .and_then(|binary| binary.env.clone())
            .unwrap_or_default()
            .into_iter()
            .collect();
        if let Some(sdk) = sdk {
            env.retain(|(key, _)| !key.eq_ignore_ascii_case("BMXPATH"));
            env.push(("BMXPATH".into(), sdk));
        }
        let server_args = server_arguments(&settings)?;
        if extension_setting(&settings, "useCompatibilityBridge").and_then(Value::as_bool)
            == Some(false)
        {
            return Ok(zed::Command {
                command,
                args: server_args,
                env,
            });
        }
        let node = node_command(worktree)?;
        let tools = tools_directory(&settings, worktree)?;
        let mut args = vec![tool_script(&tools, "blitzmax-lsp.mjs"), command];
        args.extend(server_args);
        Ok(zed::Command {
            command: node,
            args,
            env,
        })
    }
    fn language_server_initialization_options(
        &mut self,
        _: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<Value>> {
        let settings = LspSettings::for_worktree("blitzmax", worktree)?;
        let (_, sdk) = sdk_and_server(&settings, worktree)?;
        Ok(Some(options(&settings, sdk)))
    }

    fn language_server_workspace_configuration(
        &mut self,
        _: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<Value>> {
        let settings = LspSettings::for_worktree("blitzmax", worktree)?;
        // bls accepts the same {blitzmax: {...}} payload during initialization and
        // workspace/didChangeConfiguration. Explicit workspace settings win.
        let (_, sdk) = sdk_and_server(&settings, worktree)?;
        let mut config = options(&settings, sdk);
        if let Some(overrides) = settings.settings {
            merge(&mut config, overrides);
        }
        remove_extension_options(&mut config);
        Ok(Some(config))
    }

    fn get_dap_binary(
        &mut self,
        _: String,
        config: zed::DebugTaskDefinition,
        user_path: Option<String>,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::DebugAdapterBinary> {
        let mut args = Vec::new();
        let command = if let Some(path) = user_path {
            path
        } else {
            let settings = LspSettings::for_worktree("blitzmax", worktree)?;
            let node = node_command(worktree)?;
            let tools = tools_directory(&settings, worktree)?;
            args.push(tool_script(&tools, "blitzmax-dap.mjs"));
            node
        };
        let value: Value =
            zed::serde_json::from_str(&config.config).map_err(|err| err.to_string())?;
        let request = request_kind(&value)?;
        Ok(zed::DebugAdapterBinary {
            command: Some(command),
            arguments: args,
            envs: vec![],
            cwd: Some(worktree.root_path()),
            connection: None,
            request_args: zed::StartDebuggingRequestArguments {
                configuration: config.config,
                request,
            },
        })
    }

    fn dap_request_kind(
        &mut self,
        _: String,
        config: Value,
    ) -> zed::Result<zed::StartDebuggingRequestArgumentsRequest> {
        request_kind(&config)
    }

    fn dap_config_to_scenario(
        &mut self,
        config: zed::DebugConfig,
    ) -> zed::Result<zed::DebugScenario> {
        if config.stop_on_entry == Some(true) {
            return Err("BlitzMax cannot stop on entry automatically. Add DebugStop to the entry point and rebuild with -d.".into());
        }
        match config.request {
            zed::DebugRequest::Launch(launch) => Ok(zed::DebugScenario {
                label: config.label, adapter: config.adapter, build: None, tcp_connection: None,
                config: json!({ "request": "launch", "program": launch.program, "args": launch.args,
                    "cwd": launch.cwd, "env": launch.envs.into_iter().collect::<std::collections::BTreeMap<_, _>>() }).to_string(),
            }),
            _ => Err("BlitzMax supports launching debug builds; attaching to running processes is unsupported".into()),
        }
    }
}

fn merge(base: &mut Value, overrides: Value) {
    if let (Some(base), Some(overrides)) = (base.as_object_mut(), overrides.as_object()) {
        for (key, value) in overrides {
            merge(base.entry(key).or_insert(Value::Null), value.clone());
        }
    } else {
        *base = overrides;
    }
}

fn request_kind(config: &Value) -> zed::Result<zed::StartDebuggingRequestArgumentsRequest> {
    match config.get("request").and_then(Value::as_str) {
        Some("launch") => Ok(zed::StartDebuggingRequestArgumentsRequest::Launch),
        _ => Err("BlitzMax debug configurations must use request: launch".into()),
    }
}

zed::register_extension!(BlitzMaxExtension);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sdk_paths_are_host_independent() {
        assert_eq!(
            sdk_from_binary(r"C:\Program Files\BlitzMax\bin\bls.exe"),
            Some(r"C:\Program Files\BlitzMax".into())
        );
        assert_eq!(
            sdk_from_binary("/opt/BlitzMax/bin/bls"),
            Some("/opt/BlitzMax".into())
        );
        assert_eq!(
            sdk_from_binary("/usr/local/bin/bls"),
            Some("/usr/local".into())
        );
        assert_eq!(sdk_from_binary("bls"), None);
        assert_eq!(sdk_from_binary("/opt/custom/server"), None);
    }
    #[test]
    fn initialization_keeps_user_options() {
        let settings = LspSettings {
            initialization_options: Some(
                json!({"blitzmax":{"buildMode":"debug", "sdkPath":"/custom"}, "future":true}),
            ),
            ..Default::default()
        };
        let config = options(&settings, Some("/detected".into()));
        assert_eq!(config["blitzmax"]["sdkPath"], "/custom");
        assert_eq!(config["blitzmax"]["buildMode"], "debug");
        assert_eq!(config["future"], true);
    }
    #[test]
    fn configuration_merges_without_losing_sdk() {
        let mut config = json!({"blitzmax":{"sdkPath":"/sdk", "buildMode":"debug"}});
        merge(
            &mut config,
            json!({"blitzmax":{"buildMode":"release", "warnImplicitDefaultReturns":true}}),
        );
        assert_eq!(config["blitzmax"]["sdkPath"], "/sdk");
        assert_eq!(config["blitzmax"]["buildMode"], "release");
        assert!(request_kind(&json!({"request":"attach"})).is_err());
        assert!(request_kind(&json!({})).is_err());
    }
    #[test]
    fn tools_overrides_and_script_paths_are_host_independent() {
        let env = vec![("BLITZMAX_TOOLS_PATH".into(), "/external tools".into())];
        assert_eq!(
            tools_override(&LspSettings::default(), &env),
            Some("/external tools".into())
        );
        let settings = LspSettings {
            initialization_options: Some(json!({"blitzmax":{"toolsPath":"C:/custom tools"}})),
            ..Default::default()
        };
        assert_eq!(
            tools_override(&settings, &env),
            Some("C:/custom tools".into())
        );
        assert_eq!(
            tool_script("C:/custom tools/", "blitzmax-dap.mjs"),
            "C:/custom tools/blitzmax-dap.mjs"
        );
    }

    #[test]
    fn tools_cache_rejects_invalid_or_mismatched_metadata() {
        assert!(tools_manifest_matches(
            &json!({"name":"blitzmax-tools","version":TOOLS_VERSION}).to_string()
        ));
        assert!(!tools_manifest_matches("{incomplete"));
        assert!(!tools_manifest_matches(
            r#"{"name":"blitzmax-tools","version":"0.0.0"}"#
        ));
        let package: Value =
            zed::serde_json::from_str(include_str!("../tools/package.json")).unwrap();
        assert_eq!(package["version"], TOOLS_VERSION);
    }

    #[test]
    fn tool_controls_are_not_forwarded_to_language_servers() {
        let settings = LspSettings {
            initialization_options: Some(
                json!({"blitzmax":{"toolsPath":"/tools","useCompatibilityBridge":false,"buildMode":"debug"}}),
            ),
            ..Default::default()
        };
        let value = options(&settings, Some("/sdk".into()));
        assert!(value["blitzmax"].get("toolsPath").is_none());
        assert!(value["blitzmax"].get("useCompatibilityBridge").is_none());
        assert_eq!(value["blitzmax"]["buildMode"], "debug");
    }
    #[test]
    fn explicit_server_options_keep_zeds_binary_override_unset() {
        let settings = LspSettings {
            initialization_options: Some(json!({"blitzmax":{
                "serverPath":"X:/standalone server/bls.exe", "serverArguments":["--stdio"],
                "sdkPath":"C:/sdk", "toolsPath":"/tools"
            }})),
            ..Default::default()
        };
        assert!(settings.binary.is_none());
        assert_eq!(
            server_setting(&settings).unwrap(),
            Some("X:/standalone server/bls.exe".into())
        );
        assert_eq!(server_arguments(&settings).unwrap(), vec!["--stdio"]);
        let options = options(&settings, None);
        assert_eq!(options["blitzmax"]["sdkPath"], "C:/sdk");
        assert!(options["blitzmax"].get("serverPath").is_none());
        assert!(options["blitzmax"].get("serverArguments").is_none());
        for value in [json!(""), json!(false)] {
            let invalid = LspSettings {
                initialization_options: Some(json!({"blitzmax":{"serverPath":value}})),
                ..Default::default()
            };
            assert!(server_setting(&invalid).is_err());
        }
        let invalid = LspSettings {
            initialization_options: Some(json!({"blitzmax":{"serverArguments":[3]}})),
            ..Default::default()
        };
        assert!(server_arguments(&invalid).is_err());
    }
}
