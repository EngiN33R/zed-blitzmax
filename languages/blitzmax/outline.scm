[(type_definition name: (identifier) @name)
 (struct_definition name: (identifier) @name)
 (interface_definition name: (identifier) @name)
 (enum_definition name: (identifier) @name)
 (function_definition name: (identifier) @name)
 (method_definition name: (_) @name)
 (abstract_function name: (identifier) @name)
 (abstract_method name: (identifier) @name)
 (function_signature name: (identifier) @name)
 (method_signature name: (identifier) @name)] @item
(variable_declaration storage: (keyword) @context name: (identifier) @name
  (#match? @context "^([Gg][Ll][Oo][Bb][Aa][Ll]|[Cc][Oo][Nn][Ss][Tt]|[Ff][Ii][Ee][Ll][Dd])$")) @item
