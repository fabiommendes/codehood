---
name: python-publish
description: Guidelines to publish Python packages
---

# python-publish

Python libraries and CLI tools are published to PyPI. Other projects like Python
web apps might have different publishing requirements, so they are not covered
here.

Games and standalone applications may also be published with some other mechanism
such as PyInstaller, AppImage, Snapcraft, or WebAssembly. 

## PyPI

PyPI uses CI/CD pipelines with trusted partners to build and publish packages.
We use Github actions by default. If the project was never published before,
instruct the user to log into PyPI and add a new publisher at
https://pypi.org/manage/account/publishing/.

Then create a .github/workflows/publish.yml file (if it doesn't exist) with the
following content:

```yaml
# $schema=https://www.schemastore.org/github-workflow.json
on:
  release:
    types:
      - created
  push:
    tags:
      - "v*.*.*"

name: release

jobs:
  pypi-publish:
    name: upload release to PyPI
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          enable-cache: true

      - name: Set up Python
        run: uv python install

      - name: Build package distributions
        run: uv build

      - name: Publish to PyPI
        run: uv publish
```

Instruct the user to add a new tagged commit and push it to the repository.
