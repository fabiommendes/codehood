module Data.Answer exposing (..)

import Data.Question.Essay as Essay
import Data.Question.MultipleChoice as MultipleChoice
import Data.Question.MultipleSelection as MultipleSelection
import Data.Question.TrueFalse as TrueFalse
import Data.Question.Type exposing (QuestionType(..))
import Json.Encode as E


type Answer
    = EssayAnswer Essay.Answer
    | MultipleChoiceAnswer MultipleChoice.Answer
    | MultipleSelectionAnswer MultipleSelection.Answer
    | TrueFalseAnswer TrueFalse.Answer


encode : String -> Answer -> E.Value
encode id answer =
    case answer of
        -- AssociativeAnswer data ->
        --     E.object
        --         [ ( "id", E.string id )
        --         , ( "type", E.string "associative" )
        --         , ( "answer", E.dict String.fromInt (E.set E.string) data.pairings )
        --         ]
        MultipleChoiceAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "multiple-choice" )
                , ( "answer", MultipleChoice.encodeAnswer data )
                ]

        MultipleSelectionAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "multiple-selection" )
                , ( "answer", MultipleSelection.encodeAnswer data )
                ]

        TrueFalseAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "true-false" )
                , ( "answer", TrueFalse.encodeAnswer data )
                ]

        EssayAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "essay" )
                , ( "answer", Essay.encodeAnswer data )
                ]



-- FillInAnswer data ->
--     E.object
--         [ ( "id", E.string id )
--         , ( "type", E.string "fill-in" )
--         , ( "answer", E.dict identity E.string data.answer )
--         ]
-- CodeIOAnswer data ->
--     E.object
--         [ ( "id", E.string id )
--         , ( "type", E.string "code-io" )
--         , ( "answer", E.string data.code )
--         , ( "language", E.string data.lang )
--         ]
-- UnitTestAnswer data ->
--     E.object
--         [ ( "id", E.string id )
--         , ( "type", E.string "unit-test" )
--         , ( "answer", E.string data.code )
--         , ( "language", E.string data.lang )
--         ]
