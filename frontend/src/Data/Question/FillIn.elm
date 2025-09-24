module Data.Question.FillIn exposing
    ( Answer
    , FillIn(..)
    , Prompt
    , decode
    , encode
    , getId
    )

import Data.Question.ChoiceBase as Choice
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
        , choices : List Choice.Choice
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
                , ( "choices", E.list Choice.encodeChoice choices )
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
                            |> D.required "choices" (D.list Choice.choiceDecoder)
                            |> D.optional "placeholder" D.string ""

                    _ ->
                        D.fail ("Unknown type: " ++ type_)
            )



-- view : RenderOptions -> FillIn.Answer -> FillIn.Prompt -> Html Msg
-- view options { answer } body =
--     body
--         |> List.map
--             (\item ->
--                 let
--                     itemAnswer =
--                         FillIn.getId item
--                             |> Maybe.andThen (\id -> Dict.get id answer)
--                             |> Maybe.withDefault ""
--                 in
--                 viewFillInItem options itemAnswer item
--             )
--         |> div [ class "prose flex flex-col gap-2" ]
-- viewFillInItem : RenderOptions -> String -> FillIn.FillIn -> Html Msg
-- viewFillInItem _ answer body =
--     case body of
--         FillIn.Block { text } ->
--             div [ class "prose" ] [ H.text text ]
--         FillIn.Textual { id, placeholder } ->
--             input
--                 [ class "input input-primary w-full"
--                 , type_ "text"
--                 , value answer
--                 , HA.placeholder placeholder
--                 , onInput (Dict.insert id >> fillInMsg)
--                 ]
--                 []
--         FillIn.Numeric { id, unit, placeholder } ->
--             div [ class "flex gap-2 items-center" ]
--                 [ input
--                     [ class "input input-primary w-full"
--                     , type_ "text"
--                     , value answer
--                     , HA.placeholder placeholder
--                     , onInput (Dict.insert id >> fillInMsg)
--                     ]
--                     []
--                 , span [ class "text-base-content" ] [ text unit ]
--                 ]
--         FillIn.Selection { id, choices, placeholder } ->
--             div [ class "flex gap-2 items-center" ]
--                 [ H.text "todo" ]
