module Util exposing (..)

{-| Small utility functions
-}


{-| Inline if function

A more succint replacement for an if expression. Only execute if both branches
are cheap.

-}
iff : Bool -> a -> a -> a
iff condition a b =
    if condition then
        a

    else
        b


{-| Create Just object or Nothing depending on condition
-}
justIf : Bool -> a -> Maybe a
justIf condition a =
    if condition then
        Just a

    else
        Nothing
