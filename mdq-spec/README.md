`MDQ` defines a simple file format to declare questions for 
a LMS environment using straightforward Markdown idioms. This has 
a similar scope as other formats such as GIFT and AIKEN. However,
by using Markdown as the underlying format, MDQ users can leverage
all tools and familiarity with this ubiquitous technology.

`MDQ` files can declare single questions or exams. We distinguish each
case by file extension, using either `.mdq` or `.q.md` for the former
and `.mde` or `.e.md` for the later.

This document describes the accepted questions formats and their 
respective syntax.


Questions formats
=================

## Multiple choice

Multiple choice questions are declared using an unordered list:

```md
[Q1] How much is 2 + 2?
- 2
- 3
* 4
- 5
```

The question is optionally titled [Q1], and the correct answer is designated
by the bullet character. Either  `*` or `+` represent correct answers and `-`
is used for the incorrect ones.

## Multiple selection questions

```md
[Q1] What are the even numbers?
- [x] 2
- [ ] 3
- [x] 4
- [ ] 5
```

## True/False questions

```md
[Q1] Judge the statements.
- [T] Markdown is a lightweight markup.
- [F] I'd rather be writing XML.
- [T] MDQ accepts True/False questions.
- [F] The Earth is flat.
```

## Ask inputs

```md
[Q1] 2 + 2 = [^value], which is an [^oddity]

[^value]:
  - 1 
  - 2 
  - 3
  * 4

[^oddity]:
  - odd
  * even
```

## Matching

```md
[Q1] Associate the computations with their respective results

1 + 1 =
: 2

2 + 2 =
: 4

3 + 3 =
: 6
```

## I/O based E-judge questions

````md
[Q1] Create a program that ask the user name a prints "Hello <name>!".


## [code-io]

    @input $name

## [program]

```python
name = input("name: ")
print(f"Hello {name}!")
```
````

## Test based E-judge based questions

````md
[Q1] Create a function f that receives an integer and return twice its value.

## [code-test]

  compare: f

## [module]

```python
def f(x: int) -> int:
    return x + x
```
````



Advanced Features
=================

If necessary, users can specify additional information and use Markdown
markup.

```md
# Q1

    # An optional block of meta-information written in YAML
    slug: simple-sum 
    type: multiple-choice
    user-defined-attribute: 42

One or more descriptive paragraphs. Any inline **markdown** *markup* is ~~valid~~.
The exact flavor of supported Markdown depends on the target platform.

* Correct answer uses a `*` or `+` symbol.
- Incorrect choices uses a `-` symbol.
- (50%) Partial grades are specified as a percentage.
- The question may have multiple correct answers.
  > This is a feedback message presented to the user
```


Exams
=====


Advanced options
================