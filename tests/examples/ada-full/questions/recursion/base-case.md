---
title: Anatomy of a recursion
tags: [recursion]
---

Every recursive function needs a [^guard] that stops it, and each
recursive call must make the problem [^direction]. Without both, the call
stack grows until it overflows, which in CPython happens at roughly
[^limit] frames by default.

[^guard]:
* [*] base case
* [ ] loop counter
* [ ] global variable

[^direction/short-answer]: smaller

[^limit/numeric]: 1000 +- 10%
