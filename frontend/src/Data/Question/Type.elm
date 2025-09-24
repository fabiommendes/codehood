module Data.Question.Type exposing
    ( QuestionType(..)
    , decoder
    , encode
    )

import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Util.EnumDecode exposing (enumDecode, enumEncode)


type QuestionType
    = Essay
    | MultipleChoice
    | MultipleSelection
    | TrueFalse
    | FillIn
    | Associative
    | CodeIO
    | UnitTest


questionType : List ( QuestionType, String )
questionType =
    [ ( Essay, "essay" )
    , ( MultipleChoice, "multiple-choice" )
    , ( MultipleSelection, "multiple-selection" )
    , ( TrueFalse, "true-false" )
    , ( FillIn, "fill-in" )
    , ( Associative, "associative" )
    , ( CodeIO, "code-io" )
    , ( UnitTest, "unit-test" )
    ]


encode : QuestionType -> E.Value
encode =
    enumEncode questionType E.string


decoder : D.Decoder QuestionType
decoder =
    enumDecode questionType D.string
