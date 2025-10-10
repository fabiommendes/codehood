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

## Generic structure

```md
# [exam-id] Exam title
## Optional subtitle is a small description to show in listings, tables, etc.

One or more descriptive paragraphs. Any inline **markdown** *markup* is ~~valid~~.
These optional paragraphs are stored in the `preamble` attribute of the exam.

---

## [question-`id`] Question `title`

    # Yaml configuration section
    # This is an indented block of code interpreted as YAML and is used to
    # specify advanced options. The first block of comment in this section is
    # stored in the `comment` attribute for the question.
    type: multiple-choice  # (usually can be inferred from the body)
    format: md
    weight: 1.0
    grading: all-or-nothing
    shuffle: true

One or more descriptive paragraphs. Any inline **markdown** *markup* is ~~valid~~.
Those optional paragraphs are stored in the `preamble` attribute of the question.

The `stem` is the last paragraph before the question body. It usually commands the 
student to do some action (e.g., "Select all correct answers", "Write a program that...").

<QUESTION BODY, this depends on the question type>

The text after the body is stored in the `epilogue` attribute of the question.
```

## Multiple selection questions

```md
[Q1] What are the even numbers?
* [x] 2
* [ ] 3
* [x] 4
* [ ] 5
```

## Multiple choice

Multiple choice questions are declared using an unordered list:

```md
[Q1] How much is 2 + 2?
* 2 
 B  
* 3
* 4 ✅
* 5
```


## True/False questions

```md
[Q1] Judge the statements.
* [T] Markdown is a lightweight markup.
* [F] I'd rather be writing XML.
* [T] MDQ accepts True/False questions.
* [F] The Earth is flat.
```

## Fill in the blanks

```md
[Q1] 2 + 2 = [^value], which is an [^oddity]

[^value]:
  * 1 
  * 2 
  * 3
  * 4 ✅

[^oddity]:
  * odd
  * even ✅
```

## Associative questions

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
[Q1] Create a program that asks the user for their name and prints "Hello <name>!".

## [io]

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

## [test]

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