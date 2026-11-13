---
id: elm-soma
type: code
language: elm
file: Main.elm
meta:
  worker: elm-test
  attempts: 4
  penalty: 0.2
---
[Soma de uma lista] Escreva a função `soma : List Int -> Int`, que devolve a
soma dos elementos da lista. O módulo se chama `Main`.

[code]

## [template]

```elm
module Main exposing (soma)


soma : List Int -> Int
soma xs =
    0
```

## [tests]

[pré-testes](Pre.elm)

[testes](Hidden.elm)

## [answer-key]

```elm
module Main exposing (soma)


soma : List Int -> Int
soma xs =
    List.sum xs
```
