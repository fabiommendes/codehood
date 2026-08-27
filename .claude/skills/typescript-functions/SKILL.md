---
name: typescript-functions
description: Style and good practices when implementing or refactoring TypeScript functions and methods
---

# typescript-functions

Best practices and style guide for implementing TypeScript functions and methods.


## Architecture

Avoid side-effects. Most functions and methods should be pure or at least
provide local reasoning. Leave the most egregious side effects either to the
framework or to an outer layer of the application.

For reference, the list shows effects from best to worst. 

* no side effects, pure function (best).
* logging.
* local mutation of self.
* local mutation of input args.
* caching.
* print and input.
* file I/O, 
* database access.
* image display, sound, complex rendering of markup.
* network access.
* global mutation of application behavior (worst).

Try to keep implementations as high as possible in this list.

## Testing

Pure functions should be tested with examples in unit tests. If the function
respect some invariant, use property-based testing to generate a wide range of 
TypeScript's `fast-check` library is a good choice for this.

Functions up to "local mutation of input args" can be tested with no special setup.
Always use property based tests, when an invariant is known. 

Functions that use caching should usually reset the cache before each test.

Functions with simple IO should capture output using appropriate mocking for
`console.log` and `console.error` and for `prompt`.

Functions that read files should use mocking and functions that write files
should do so in temporary directories, e.g., using the `tmp` library.

Functions that access databases should use transactions and rollbacks to avoid 
leaving the database in a dirty state. Many frameworks provide built-in support 
for this via pytest fixtures.

Functions that produces complex multimedia usually should be tested via approval
testing. Python have the approvaltests.Python library for this.

Network access should usually be mocked in unit tests and tested in integration 
tests.

When a function produces a global mutation of application behavior, it should 
should also provide a snapshot mechanism that restore the application to its 
previous state. Ideally it should be done using context managers. Ask the user
if this mechanism should be exposed as a public API or not.


## Coding style

Names of functions are camelCase. Always document public functions. Always type
input and output parameters. At toplevel, use `function` declarations instead of
`const` with arrow functions. Use arrow functions as callbacks and for inner
functions.


## Arguments

Use at most 4 positional arguments in a function. If it has more then 4
parameters, use a single object parameter with named properties.

If the function has more than 2 arguments of the same type, prefer an object 
parameter with named properties. Break this rule if the function expresses a 
clear relation between the two arguments or if the position does not matter.

A clear relation has form `word(first, second)` and can be understood as
`first word second`.

```typescript
// good
function join(a: string, b: string): string { ... }
function hasPrefix(text: string, prefix: string): boolean { ... }
function replace(text: string, { sub, by }: { sub: string, by: string }): string { ... }

// bad
function replace(text: string, sub: string, by: string): string { ... }
```

If the function expresses a relation between two arguments and the role of each
argument is implicit by position, also require them to be positional. E.g., 

```python
def swap[T](a: T, b: T, /) -> tuple[T, T]: ...
```

If the function has more than one optional argument with the same type, require
both to be keyword-only. If it has more than 3 optional arguments, require all
of them to be keyword-only. Use the `*` symbol to enforce this in the function
signature. E.g., 

```python
def join_items(data: Iterable[str], *, sep: str = ",", end: str = "\n") -> str: ...
```

If the function does not change the input args, prefer interfaces over concrete types.


## Documentation comments

Use JSDoc style. Always break the block comment to have more then one line,
even for short comments, e.g.,

```typescript
/**
 * Return a new array in reverse order of elements.
 */
function reverse() {
    // ...
}
```

Use markdown to structure information (e.g., lists, code blocks).

The first line should be a short summary of the function's purpose. If there are
more relevant details, they should be included as one or more paragraphs
separated by blank lines.

Use JSDoc tags `@param`, `@returns`, and `@throws` to document parameters,
return values and exceptions. Do not include the types in the `@param` and
`@returns` tags. Specify them in the function signature.

Put a blank line before the first `@param` tag and before the `@returns` tag and `@throws` tags. 

Public functions that do not produce side effects should be documented with a
doctest example. Use the `@example` tag. Skip the test if it is too complex or
requires too much external dependencies or preparation.

Below is a good example of how to document a function:

```typescript
/** 
  * Return a new array in reverse order of elements.
  *
  * @example reverse([1, 2, 3]) 
  * //=> [3,2,1]
  * 
  * @param arr - The array to reverse.
  * @param inplace - If true, reverse the array in place. Otherwise, return a new array.
  *
  * @returns A new array with the elements in reverse order.
  */ 
function reverse<T>(arr: T[], inplace: boolean = false): T[] {
    return inplace? arr.reverse() : [...arr].reverse();
}
```
