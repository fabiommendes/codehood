# Codehood CLI

This is the command line interface for Codehood. It can be used by instructors 
or students to manage their Codehood projects and assignments.

## Installation

You can install the Codehood CLI using pipx, uv or something similar.

```bash
# Using pip
pipx install codehood-cli

# Using uv
uv tool install codehood-cli
```


##  For instructors

In Codehood, you manage your course in a local repository, possibly under
version control, and then push changes to the Codehood server. Your local files
are the source of truth, and so you must init the course repository before
anything.

```bash
codehood init
```

It will create the following folder structure in your current working directory:

```
├── .codehood/
├── questions/
│   └── example.mdq
├── exams/
│   ├── draft/
│   │   └── example.md
│   ├── practice/
│   │   └── example.md
│   └── published/
├── resources/
├── codehood.toml
├── calendar.md
├── roster.csv
└── README.md
```

It will also ask for your credentials to connect to the Codehood server and
storing them in the `codehood.toml` file.

We manage the course by editing or adding files in the local repository and then
pushing changes to the Codehood server using a simple command:

```bash
codehood push
```


## For students

TBD!