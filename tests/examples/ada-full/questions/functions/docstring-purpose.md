---
title: Why docstrings
type: essay
tags: [functions, style]
---

Explain, in a paragraph, what a docstring is for and how it differs from
a comment.

[essay]

## [answer-key]

A docstring is a string literal as the first statement of a module,
class, or function. It is retained at runtime as `__doc__`, so tooling
(`help()`, IDEs, documentation generators) can read it. A comment is
stripped by the parser and exists only for whoever reads the source. A
docstring describes the contract -- what the callable does, its arguments
and its result -- while a comment explains a decision in the
implementation.
