## Comment and Prose Style

These rules apply to all prose you write including code comments, JSDoc/docstrings, Markdown docs, commit messages, and PR descriptions. They do NOT apply to code itself (type annotations, object literals, ternaries), to identifiers/format notation such as `host:port` or `"ip:port"`, or to string literals like error messages.

- No explanatory colons. Never use the "label: explanation" pattern (e.g. `Optional: without it...`, `Default: refuse`). Rephrase into a normal sentence or break it with a period instead.

- No semicolons. Never join clauses with a semicolon. Write two sentences, or join them with "and", "so", "because", etc.

- No em-dashes (—). Use parentheses for asides, a comma for a pause, or split into separate sentences.

- Write complete sentences. Every sentence needs a subject and a verb. Avoid terse fragments and one-word "sentences" like `Optional.`, `Abortive close.`, or `Graceful FIN toward the guest.` Lead property/field docs with a verb (e.g. "Holds the canonical address...", "Returns the bytes the guest sent").

- Imperative or third-person verb phrases are fine (e.g. "Resolve a hostname...", "Aborts every channel..."). The rule is against verb-less fragments, not against concise sentences.

- No asterisk emphasis. Do not wrap words in single asterisks for emphasis (e.g. `*this*`). Use plain wording instead.
