---
name: python-paths
description: Good practices when working with file paths in Python
---

# python-paths

Python has 3 standard ways to represent file paths: `str`, `bytes`, and `pathlib.Path`. 
Always use `pathlib.Path` for new code, unless it is interacting with third
party code that requires `str` or `bytes`. 

`Path`-like objects like `trio.Path` are also acceptable defaults.

Prefer high level APIs under `pathlib.Path` over low level APIs like `os.path`. 
For example, use `Path.read_text()` instead of `open(path).read()`, and use `Path.iterdir()`
instead of `os.listdir()`. 

When interacting with third party code that requires `str` or `bytes`, use the
`str(Path)` or `bytes(path)` as appropriate. When reading paths from those APIs,
use `Path(path)` to convert them back to `Path` objects.

It is OK to design public APIs that accept `str`, `bytes`, or `Path` objects. In
that case, define toplevel types like `PathLike = str | bytes | Path` and use
them in type hints. Use `Path(path)` to convert them to `Path` objects for
internal use.
