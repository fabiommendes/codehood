module Data._Question.Pairings exposing (..)

import Dict exposing (Dict)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Set exposing (Set)


type alias Id =
    String


type alias Pairings =
    { keys : List { text : String }
    , values : List { id : Id, text : String }
    }


type alias Answer =
    { pairings : Dict Int (Set Id) }


encode : Pairings -> List ( String, E.Value )
encode { keys, values } =
    let
        key data =
            E.object
                [ ( "text", E.string data.text ) ]

        value data =
            E.object
                [ ( "id", E.string data.id ), ( "text", E.string data.text ) ]
    in
    [ ( "keys", E.list key keys )
    , ( "values", E.list value values )
    ]


decode : D.Decoder Pairings
decode =
    let
        keys =
            D.list
                (D.succeed (\text -> { text = text })
                    |> D.required "text" (D.field "text" D.string)
                )

        values =
            D.list
                (D.succeed (\id text -> { id = id, text = text })
                    |> D.required "id" (D.field "id" D.string)
                    |> D.required "text" (D.field "text" D.string)
                )
    in
    D.succeed Pairings
        |> D.required "keys" keys
        |> D.required "values" values
