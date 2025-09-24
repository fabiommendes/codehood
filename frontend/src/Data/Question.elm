module Data.Question exposing
    ( Question(..)
    , answer
    , comment
    , decoder
    , encode
    , epilogue
    , footnotes
    , format
    , id
    , isGraded
    , media
    , preamble
    , questionType
    , stem
    , tags
    , title
    , toEmptyAnswer
    , updateAnswer
    , weight
    )

{-| The generic question type
-}

import Data.Answer exposing (Answer(..))
import Data.Question.Base as Base exposing (Footnote, MediaObject, TextFormat)
import Data.Question.Essay as Essay
import Data.Question.MultipleChoice as MultipleChoice
import Data.Question.MultipleSelection as MultipleSelection
import Data.Question.TrueFalse as TrueFalse
import Data.Question.Type as Type exposing (QuestionType(..))
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Util.Lens exposing (question)


type Question
    = MultipleChoiceQuestion MultipleChoice.MultipleChoice
    | MultipleSelectionQuestion MultipleSelection.MultipleSelection
    | EssayQuestion Essay.Essay
    | TrueFalseQuestion TrueFalse.TrueFalse



--- ATTRUBUTES


id : Question -> String
id =
    getter .id


title : Question -> String
title =
    getter .title


stem : Question -> String
stem =
    getter .stem


format : Question -> TextFormat
format =
    getter .format


weight : Question -> Float
weight =
    getter .weight


preamble : Question -> String
preamble =
    getter .preamble


epilogue : Question -> String
epilogue =
    getter .epilogue


footnotes : Question -> List Footnote
footnotes =
    getter .footnotes


media : Question -> List MediaObject
media =
    getter .media


tags : Question -> List String
tags =
    getter .tags


comment : Question -> String
comment =
    getter .comment


isGraded : Question -> Bool
isGraded =
    getter .isGraded


questionType : Question -> QuestionType
questionType question =
    case question of
        MultipleChoiceQuestion _ ->
            Type.MultipleChoice

        MultipleSelectionQuestion _ ->
            Type.MultipleSelection

        EssayQuestion _ ->
            Type.Essay

        TrueFalseQuestion _ ->
            Type.TrueFalse


{-| A prism for setting an answer
-}
answer : { tryGet : Question -> Maybe Answer, set : Answer -> Question -> Question }
answer =
    let
        answerGetter : Question -> Maybe Answer
        answerGetter question =
            case question of
                MultipleChoiceQuestion data ->
                    data.answer
                        |> Maybe.map MultipleChoiceAnswer

                MultipleSelectionQuestion data ->
                    data.answer
                        |> Maybe.map MultipleSelectionAnswer

                EssayQuestion data ->
                    data.answer
                        |> Maybe.map EssayAnswer

                TrueFalseQuestion data ->
                    data.answer
                        |> Maybe.map TrueFalseAnswer

        answerSetter : Answer -> Question -> Question
        answerSetter value question =
            case ( question, value ) of
                ( MultipleChoiceQuestion data, MultipleChoiceAnswer ans ) ->
                    { data | answer = Just ans }
                        |> MultipleChoiceQuestion

                ( MultipleSelectionQuestion data, MultipleSelectionAnswer ans ) ->
                    { data | answer = Just ans }
                        |> MultipleSelectionQuestion

                ( EssayQuestion data, EssayAnswer ans ) ->
                    { data | answer = Just ans }
                        |> EssayQuestion

                ( TrueFalseQuestion data, TrueFalseAnswer ans ) ->
                    { data | answer = Just ans }
                        |> TrueFalseQuestion

                _ ->
                    question
    in
    { tryGet = answerGetter, set = answerSetter }


toEmptyAnswer : Question -> Question
toEmptyAnswer question =
    case question of
        MultipleChoiceQuestion data ->
            { data | answer = Nothing }
                |> MultipleChoiceQuestion

        MultipleSelectionQuestion data ->
            { data | answer = Nothing }
                |> MultipleSelectionQuestion

        EssayQuestion data ->
            { data | answer = Nothing }
                |> EssayQuestion

        TrueFalseQuestion data ->
            { data | answer = Nothing }
                |> TrueFalseQuestion


updateAnswer : (Answer -> Answer) -> Question -> Question
updateAnswer f question =
    case answer.tryGet question of
        Just ans ->
            answer.set (f ans) question

        Nothing ->
            question



--- JSON ENCODE/DECODE


encode : Question -> E.Value
encode question =
    case question of
        MultipleChoiceQuestion data ->
            MultipleChoice.encode data

        MultipleSelectionQuestion data ->
            MultipleSelection.encode data

        EssayQuestion data ->
            Essay.encode data

        TrueFalseQuestion data ->
            TrueFalse.encode data


decoder : D.Decoder Question
decoder =
    D.field "type" Type.decoder
        |> D.andThen
            (\kind ->
                case kind of
                    Type.MultipleChoice ->
                        MultipleChoice.decoder |> D.map MultipleChoiceQuestion

                    Type.MultipleSelection ->
                        MultipleSelection.decoder |> D.map MultipleSelectionQuestion

                    Type.Essay ->
                        Essay.decoder |> D.map EssayQuestion

                    Type.TrueFalse ->
                        TrueFalse.decoder |> D.map TrueFalseQuestion

                    _ ->
                        D.fail "Invalid question type"
            )


getter : (Base.BaseFields -> a) -> (Question -> a)
getter f question =
    case question of
        MultipleChoiceQuestion data ->
            Base.mapBase f data

        MultipleSelectionQuestion data ->
            Base.mapBase f data

        EssayQuestion data ->
            Base.mapBase f data

        TrueFalseQuestion data ->
            Base.mapBase f data
