module Data._Question.FillIn exposing (Answer, FillIn(..), Prompt, decode, encode, getId)

import Data._Question.Choice as Choice
import Dict exposing (Dict)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


type alias Id =
    String


type FillIn
    = Block
        { text : String
        }
    | Textual
        { id : Id
        , placeholder : String
        }
    | Numeric
        { id : Id
        , unit : String
        , placeholder : String
        }
    | Selection
        { id : Id
        , choices : Choice.Prompt
        , placeholder : String
        }


type alias Answer =
    { answer : Dict Id String }


type alias Prompt =
    List FillIn


getId : FillIn -> Maybe Id
getId item =
    case item of
        Block _ ->
            Nothing

        Textual { id } ->
            Just id

        Numeric { id } ->
            Just id

        Selection { id } ->
            Just id


encode : FillIn -> E.Value
encode item =
    case item of
        Block text ->
            E.object
                [ ( "type", E.string "block" )
                , ( "text", E.string text.text )
                ]

        Textual { id, placeholder } ->
            E.object
                [ ( "type", E.string "text" )
                , ( "id", E.string id )
                , ( "placeholder", E.string placeholder )
                ]

        Numeric { id, unit, placeholder } ->
            E.object
                [ ( "type", E.string "numeric" )
                , ( "id", E.string id )
                , ( "unit", E.string unit )
                , ( "placeholder", E.string placeholder )
                ]

        Selection { id, choices, placeholder } ->
            E.object
                [ ( "type", E.string "selection" )
                , ( "id", E.string id )
                , ( "choices", E.list Choice.encode choices )
                , ( "placeholder", E.string placeholder )
                ]


decode : D.Decoder FillIn
decode =
    D.field "type" D.string
        |> D.andThen
            (\type_ ->
                case type_ of
                    "block" ->
                        D.map
                            (\text ->
                                Block { text = text }
                            )
                            (D.field "text" D.string)

                    "text" ->
                        D.succeed
                            (\id placeholder ->
                                Textual { id = id, placeholder = placeholder }
                            )
                            |> D.required "id" D.string
                            |> D.optional "placeholder" D.string ""

                    "numeric" ->
                        D.succeed
                            (\id unit placeholder ->
                                Numeric { id = id, unit = unit, placeholder = placeholder }
                            )
                            |> D.required "id" D.string
                            |> D.required "unit" D.string
                            |> D.optional "placeholder" D.string ""

                    "selection" ->
                        D.succeed
                            (\id choices placeholder ->
                                Selection { id = id, choices = choices, placeholder = placeholder }
                            )
                            |> D.required "id" D.string
                            |> D.required "choices" (D.list Choice.decode)
                            |> D.optional "placeholder" D.string ""

                    _ ->
                        D.fail ("Unknown type: " ++ type_)
            )
