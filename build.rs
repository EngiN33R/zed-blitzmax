fn main() {
    println!("cargo:rerun-if-env-changed=BLITZMAX_GRAMMAR_DIR");
    if !std::env::var("TARGET").unwrap().starts_with("wasm32") {
        let grammar = std::env::var_os("BLITZMAX_GRAMMAR_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tree-sitter-blitzmax")
            });
        let source = grammar.join("src");
        assert!(source.join("parser.c").exists(), "BlitzMax grammar missing: clone tree-sitter-blitzmax beside zed-blitzmax, or set BLITZMAX_GRAMMAR_DIR");
        println!("cargo:rerun-if-changed={}", source.display());
        cc::Build::new()
            .include(&source)
            .file(source.join("parser.c"))
            .file(source.join("scanner.c"))
            .warnings(false)
            .compile("tree-sitter-blitzmax");
    }
}
