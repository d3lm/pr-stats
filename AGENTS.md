## Comment and Prose Style

These rules apply to all prose you write including code comments, JSDoc/docstrings, Markdown docs, commit messages, and PR descriptions. They do NOT apply to code itself (type annotations, object literals, ternaries), to identifiers/format notation such as `key:value` or `HH:MM`, or to string literals like error messages.

- No explanatory colons. Never use the "label: explanation" pattern (e.g. `Optional: without it...`, `Default: 30 seconds`). Rephrase into a normal sentence or break it with a period instead.

- No semicolons. Never join clauses with a semicolon. Write two sentences, or join them with "and", "so", "because", etc.

- No em-dashes (—). Use parentheses for asides, a comma for a pause, or split into separate sentences.

- Write complete sentences. Every sentence needs a subject and a verb. Avoid terse fragments and one-word "sentences" like `Optional.`, `Cached.`, or `Fallback for older clients.` Lead property/field docs with a verb (e.g. "Holds the resolved config...", "Returns the items the user selected").

- Imperative or third-person verb phrases are fine (e.g. "Parse the config file...", "Retries every failed request..."). The rule is against verb-less fragments, not against concise sentences.

- No asterisk emphasis. Do not wrap words in single asterisks for emphasis (e.g. `*this*`). Use plain wording instead.

- Avoid unnecessary code narration. Comments explain why the code does something, not what it does. Do not restate what a line or block already says (e.g. `// increment the counter` above `count += 1`). Write a comment only when it carries intent, a constraint, an invariant, or a non-obvious decision that the code cannot express on its own, and leave self-explanatory code uncommented.

## When to Write a Comment

Default to writing no comment at all. Most comments restate the code, narrate an edit, or excuse a workaround, and they go stale the moment the code changes. Before adding one, try to make the code say it instead with a better name, an extracted function, a type, or an assertion.

A comment is allowed only when it fits one of these cases.

- It explains a specific reason or decision that the code cannot express, such as a platform or framework quirk, a vendor or protocol rule, or a trade-off that was chosen on purpose. It says why, never what.
- It is a doc comment on a type, a property, or a public API that describes the contract a caller relies on.
- It links to an issue, RFC, spec, or vendor documentation page that explains a constraint.
- It is a license header.

Everything else gets deleted. In particular, follow these rules.

- Do not narrate what the next line or block does (e.g. `// increment the counter` above `count += 1`).
- Do not add section banners, dividers, or commented-out code.
- Do not record change history ("added X", "now handles Y", "previously Z") or tell the reviewer why your edit is correct. That belongs in the commit message or PR description.
- Do not write a long justification for a workaround. If the code needs a paragraph to defend itself, fix the code instead.
- Do not write warning labels like `IMPORTANT`, `do not remove`, or `fine for now` without the concrete reason behind them.
- Do not leave a `TODO` or `FIXME` unless it links to a tracked issue.
- Do not silence a linter. A lint warning means the code should change, so fix the code until the warning goes away. If you believe a rule is wrong for the whole project, stop and ask the user before touching the lint configuration.

When you are unsure whether a comment qualifies, leave it out.
