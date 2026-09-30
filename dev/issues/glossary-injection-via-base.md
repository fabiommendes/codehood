---
type: note
status: active
tags: [tooling, base, glossary, agents]
relatedTo: [glossary, agents-md, base-domains]
---

# Inject glossary definitions on demand through base

`AGENTS.md` tells every agent to read the list of glossary terms at the start
of a session and grep `GLOSSARY.md` for each definition it needs. That is a
fragile grep per term, on every session, in three repositories (server, CLI,
mdq).

`base` cannot do this from a synced document: `base sync` files
`GLOSSARY.md` as one node with `hasSection` edges, `base recall --keyword`
does not find the sections, and the prompt hook injects per matched domain,
not per term mentioned. What it can do is match a keyword to a domain and
inject that domain's rules once per session.

## Proposal

- One domain per glossary term, in `~/git/codehood/.base/domains.toml`:
  `prompt_keywords = ["<term>"]`, and `file_keywords` with the same term, so
  a prompt or a touched file that mentions it brings the definition in.
- The definition as the domain's single rule (`base rule add`).
- A script, `~/git/codehood/.base/scripts/glossary-to-base`, that reads the
  `## Term` sections of the three glossaries and regenerates the domains and
  rules, removing the ones whose term is gone. Run by hand after editing a
  glossary, or from the session-start hook.
- `AGENTS.md` then drops the grep instructions and says that definitions
  arrive through `base` when a term comes up, with `GLOSSARY.md` still the
  source to edit.

Cost: about 45 domains and rules that must follow the glossaries, hence the
script. Alternative with no script: every definition as a note of one
domain, which injects the whole list on each match, about 1.5k tokens per
session.
