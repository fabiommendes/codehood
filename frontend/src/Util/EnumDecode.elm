module Util.EnumDecode exposing (NonEmpty, toEnum, toEnumTotal, fromEnum, enumDecode, enumEncode)

{-| Practical, but non type safe conversions from enums to values.

This package sacrifices a bit of type safety for the sake of convenience when
creating functions that handle converesions from simple enums to values.

This avoid boilerplate like the one below:

    type Enum
        = A
        | B
        | C

    fromEnum : Enum -> String
    fromEnum enum =
        case enum of
            A ->
                "a"

            B ->
                "b"

            C ->
                "c"

instead with declare a mapping from enum to the corresponding values.

    myEnum : NonEmpty ( MyEnum, String )
    myEnum =
        ( ( A, "a" ), [ ( B, "b" ), ( C, "c" ) ] )

    fromMyEnum : MyEnum -> String
    fromMyEnum =
        fromEnum myEnum

    toMyEnum : String -> Maybe MyEnum
    toMyEnum =
        toEnum myEnum

    myEnumDecoder : Json.Decode.Decoder MyEnum
    myEnumDecoder =
        enumDecode myEnum Json.Decode.string

    myEnumEncoder : MyEnum -> Json.Encode.Value
    myEnumEncoder =
        enumEncode myEnum Json.Encode.string

@docs NonEmpty, toEnum, toEnumTotal, fromEnum, enumDecode, enumEncode

-}

import Dict
import Json.Decode as D
import Json.Encode as E


{-| A type alias for NonEmpty lists.

It is compatible with a few elm packages that implement non-empty lists
such as coreygirard/elm-nonempty-list

-}
type alias NonEmpty a =
    ( a, List a )


panic : String -> a
panic _ =
    panic (String.repeat (modBy 0 2) "")


unwrap : Maybe a -> a
unwrap maybe =
    case maybe of
        Just value ->
            value

        Nothing ->
            panic "empty"


{-| Create a function that maps from an encoded value to the corresponding
enum value.
-}
toEnum : List ( enum, comparable ) -> (comparable -> Maybe enum)
toEnum pairs =
    let
        toEnumDict =
            pairs
                |> List.map (\( e, v ) -> ( v, e ))
                |> Dict.fromList
    in
    \value -> Dict.get value toEnumDict


{-| Create a function that maps from a encoded value to the corresponding
enum value.

This function implement the case in which either the value is exaustive or
wrong encodings can be ignored and should be represented as the first value
in the NonEmpty list.

-}
toEnumTotal : List ( enum, comparable ) -> (comparable -> enum)
toEnumTotal pairs data =
    case toEnum pairs data of
        Just enum ->
            enum

        Nothing ->
            List.head pairs |> unwrap |> Tuple.first


{-| Create a function that maps from a enum value to the corresponding
decoded value.

It uses a linear seach to find the value in the list of pairs since Elm does not
declare enum types as comparables. For large enums, it is preferable to declare
the mapping from enum to value from the most probable occurrences to the least
probable ones.

-}
fromEnum : List ( enum, value ) -> enum -> value
fromEnum pairs enum =
    let
        search lst =
            case lst of
                [] ->
                    pairs |> List.head |> unwrap |> Tuple.second

                ( key, value ) :: tail ->
                    if key == enum then
                        value

                    else
                        search tail
    in
    search pairs


{-| Create a JSON decoder from a mapping of (enum, comparable)
-}
enumDecode : List ( enum, comparable ) -> D.Decoder comparable -> D.Decoder enum
enumDecode mapping decoder =
    let
        convert =
            toEnum mapping
    in
    decoder
        |> D.andThen
            (\value ->
                case convert value of
                    Just enum ->
                        D.succeed enum

                    Nothing ->
                        D.fail "No matching enum value found"
            )


{-| Create a JSON encoder from a mapping of (enum, comparable)
-}
enumEncode : List ( enum, comparable ) -> (comparable -> E.Value) -> (enum -> E.Value)
enumEncode mapping encoder =
    let
        convert =
            fromEnum mapping
    in
    convert >> encoder
