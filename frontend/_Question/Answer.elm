module Data.Answer exposing (..)

import Data.Question.BaseChoice as Choice
import Data.Question.Code as Code
import Data.Question.Essay as Essay
import Data.Question.FillIn as FillIn
import Data.Question.Pairings as Pairings
import Json.Encode as E


type Answer
    = AssociativeAnswer Pairings.Answer
    | MultipleChoiceAnswer Choice.Answer
    | MultipleSelectAnswer Choice.Answer
    | TrueFalseAnswer Choice.TrueFalseAnswer
    | EssayAnswer Essay.Answer
    | FillInAnswer FillIn.Answer
    | CodeIOAnswer Code.Answer
    | UnitTestAnswer Code.Answer


encode : String -> Answer -> E.Value
encode id answer =
    case answer of
        AssociativeAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "associative" )
                , ( "answer", E.dict String.fromInt (E.set E.string) data.pairings )
                ]

        MultipleChoiceAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "multiple-choice" )
                , ( "answer", E.set E.string data.answer )
                ]

        MultipleSelectAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "multiple-select" )
                , ( "answer", E.set E.string data.answer )
                ]

        TrueFalseAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "true-false" )
                , ( "answer", E.dict identity E.bool data.answer )
                ]

        EssayAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "essay" )
                , ( "answer", E.string data.text )
                ]

        FillInAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "fill-in" )
                , ( "answer", E.dict identity E.string data.answer )
                ]

        CodeIOAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "code-io" )
                , ( "answer", E.string data.code )
                , ( "language", E.string data.lang )
                ]

        UnitTestAnswer data ->
            E.object
                [ ( "id", E.string id )
                , ( "type", E.string "unit-test" )
                , ( "answer", E.string data.code )
                , ( "language", E.string data.lang )
                ]
