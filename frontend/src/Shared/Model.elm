module Shared.Model exposing
    ( Model
    , Theme(..)
    , init
    , theme
    )

import Data.Classroom exposing (Classroom)
import Data.Credentials exposing (Credentials)
import Data.Language as Language exposing (Language)
import Json.Decode as D
import Json.Encode as E


{-| Normally, this value would live in "Shared.elm"
but that would lead to a circular dependency import cycle.

For that reason, both `Shared.Model` and `Shared.Msg` are in their
own file, so they can be imported by `Effect.elm`

-}
type alias Model =
    { baseApiUrl : String
    , theme : Theme
    , credentials : Maybe Credentials
    , classrooms : Maybe (List Classroom)
    , language : Language
    }


init : Model
init =
    { baseApiUrl = "http://localhost:8000/api/v1"
    , theme = Light
    , credentials = Nothing
    , classrooms = Nothing
    , language = Language.init
    }


type Theme
    = Light
    | Dark


theme : { encode : Theme -> E.Value, decode : D.Decoder Theme }
theme =
    { encode =
        \value ->
            case value of
                Light ->
                    E.string "light"

                Dark ->
                    E.string "dark"
    , decode =
        D.string
            |> D.andThen
                (\value ->
                    case value of
                        "light" ->
                            D.succeed Light

                        "dark" ->
                            D.succeed Dark

                        _ ->
                            D.fail ("Invalid theme: " ++ value)
                )
    }
