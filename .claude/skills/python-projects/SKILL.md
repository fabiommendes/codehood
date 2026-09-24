---
name: python-projects
description: Style and good practices when implementing Python projects
---

# python-projects

## Tooling

The default choice is to use `uv` for project management. Select this for new
projects, but do not change old projects to use it.

Also select those defaults dev tooling on new projects:

* ruff for linting and formatting.
* pytest for testing.
* doc-zero for documentation.
* taskipy for task management.
* mypy for type checking.


## Tasks

All common dev commands should be explicity encoded as tasks. This usually means
adding entries to the `[tool.taskipy.tasks]` section of the `pyproject.toml`
file.

Every project should define at least the following tasks:

* `test` - run all tests.
* `lint` - run all linters and formatters.
* `docs` - build the documentation.
* `ci` - run all CI checks, including tests, linters, and docs.
* `release` - perform all checks that ensure the project is ready to be released to PyPI.


## Source layout

Complex projects with multiple packages should use the `src` layout. This means
that the source code is placed in a `src` directory, and the tests are placed in
a `tests` directory at the root of the project.

```text
src/
    package1/
    package2/
tests/
    package1/
    package2/
```

Smaller projects consisting of a single package can use the simpler layout,
where the source code and tests are placed in the same directory.

```text
package/
    __init__.py
    module1.py
    ...
tests/
    test_module1.py
    ...
```

In order to support the later, it is important to add the following lines in 
`pyproject.toml`:

```toml
[tool.uv.build-backend]
module-name = "<package-name>"
module-root = "."
```

## CI/CD

The project should have a CI/CD pipeline that runs all tests, linters, and docs 
on every commit. The pipeline should also run the `release` task on every tag.

By default, use GitHub Actions for CI/CD. The default workflow should be placed
in `.github/workflows/ci.yml`. 

If the project is a library, the workflow should also build and publish the 
package to PyPI on every tag.

## Readme

The project should have a `README.md` file at the root of the project. 
The README should include:

* A short description of the project.
* A badge for the CI/CD pipeline.
* A badge for the latest release.
* Installation instructions.
* Usage examples.

## License

The project should have a `LICENSE` file at the root of the project. If the
LICENSE is not present, create a `LICENSE` file with the MIT license.
