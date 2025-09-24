# Codehood

Codehood is a Classroom Management System for programming courses. It embraces
the use of programming tools and practices to enhance the learning experience.

This is a multi-repo project with a Django-Ninja API backend and an Elm
frontend.

## Sub-projects

- [API Backend](./server/README.md) - Django + Ninja REST API
- [Frontend](./frontend/README.md) - Elm + Elm-Land SPA
- [CLI Tool](./cli/README.md) - Python CLI for managing Codehood instances
- [Markdown questions](./mdq/README.md) - Python library for handling questions
  defined as Markdown files
- [MDQ-Spec](./mdq-spec/README.md) - Questions are parsed according to this spec
  to JSON files. This defines the format using a JSON Schema.
- [Django Katana](./django-katana/README.md) - Smarter routers for Django Ninja.
- [Django Shuriken](./django-shuriken/README.md) - JSON-RPC integration with
  Django Ninja.