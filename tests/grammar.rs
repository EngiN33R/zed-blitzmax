use std::{fs, path::Path};
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator};

#[link(name = "tree-sitter-blitzmax", kind = "static")]
extern "C" {
    fn tree_sitter_blitzmax() -> *const ();
}

fn language() -> Language {
    Language::new(unsafe { tree_sitter_language::LanguageFn::from_raw(tree_sitter_blitzmax) })
}

#[test]
fn parses_language_and_compiles_every_zed_query() {
    let language = language();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let source = include_str!("fixtures/language.bmx");
    let tree = parser.parse(source, None).unwrap();
    assert!(
        !tree.root_node().has_error(),
        "{}",
        tree.root_node().to_sexp()
    );
    for entry in fs::read_dir("languages/blitzmax").unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|ext| ext == "scm") {
            Query::new(&language, &fs::read_to_string(&path).unwrap())
                .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
        }
    }
    let outline = Query::new(&language, include_str!("../languages/blitzmax/outline.scm")).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&outline, tree.root_node(), source.as_bytes());
    let mut names = Vec::new();
    while let Some(found) = matches.next() {
        for capture in found.captures {
            if outline.capture_names()[capture.index as usize] == "name" {
                names.push(
                    capture
                        .node
                        .utf8_text(source.as_bytes())
                        .unwrap()
                        .to_owned(),
                );
            }
        }
    }
    for name in [
        "TExample", "Name", "Compute", "SPoint", "EColour", "puts", "Add",
    ] {
        assert!(
            names.iter().any(|n| n == name),
            "missing {name} from {names:?}"
        );
    }
    assert!(!names.iter().any(|n| n == "Fake"));
}

#[test]
fn parses_examples_and_recovers_after_incomplete_edits() {
    let mut parser = Parser::new();
    parser.set_language(&language()).unwrap();
    for path in ["examples/hello.bmx", "examples/debug.bmx"] {
        let source = fs::read_to_string(path).unwrap();
        assert!(
            !parser.parse(source, None).unwrap().root_node().has_error(),
            "{path}"
        );
    }
    let incomplete = "Type TBroken\n Method Update(\n";
    let old = parser.parse(incomplete, None).unwrap();
    assert!(old.root_node().has_error());
    let repaired = "Type TBroken\n Method Update()\n EndMethod\nEndType\n";
    assert!(!parser
        .parse(repaired, None)
        .unwrap()
        .root_node()
        .has_error());
    for source in [
        "Print 1",
        "' comment",
        "Rem\nUnfinished documentation",
        "Print \"\"\"unfinished",
        "Function Test()\nEndFunction",
        "Type TExample\nEnd Type",
        "Print \"'\"\n",
    ] {
        assert!(
            !parser.parse(source, None).unwrap().root_node().has_error(),
            "{source}"
        );
    }
}

#[test]
fn manifest_and_language_configuration_are_consistent() {
    let manifest: toml::Value = toml::from_str(include_str!("../extension.toml")).unwrap();
    let config: toml::Value =
        toml::from_str(include_str!("../languages/blitzmax/config.toml")).unwrap();
    assert_eq!(config["name"].as_str(), Some("BlitzMax"));
    assert_eq!(
        manifest["language_servers"]["blitzmax"]["languages"][0].as_str(),
        config["name"].as_str()
    );
    for field in [
        "highlights.scm",
        "outline.scm",
        "brackets.scm",
        "indents.scm",
        "tasks.json",
    ] {
        assert!(Path::new("languages/blitzmax").join(field).exists());
    }
}
