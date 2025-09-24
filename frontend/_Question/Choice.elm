module Data._Question.Choice exposing (Answer, Choice, Id, Prompt, TrueFalseAnswer, decode, encode)

import Dict exposing (Dict)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Set exposing (Set)


type alias Id =
    String


type alias Choice =
    { id : Id
    , text : String
    , feedback : String
    }


type alias Prompt =
    List Choice


type alias Answer =
    { answer : Set Id }


type alias TrueFalseAnswer =
    { answer : Dict Id Bool }


decode : D.Decoder Choice
decode =
    D.succeed Choice
        |> D.required "id" D.string
        |> D.required "text" D.string
        |> D.optional "feedback" D.string ""


encode : Choice -> E.Value
encode choice =
    E.object
        [ ( "id", E.string choice.id )
        , ( "text", E.string choice.text )
        , ( "feedback", E.string choice.feedback )
        ]
