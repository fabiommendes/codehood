module Mdq.Json exposing
    ( encodeArtifactType, encodeAssociativeItemImage, encodeAssociativeItemKeyImage
    , encodeAssociativeItemKeyText, encodeAssociativeItemText, encodeAssociativeQuestion, encodeChoice
    , encodeCodeIoConf, encodeCodingIOQuestion, encodeCompilation, encodeEnvironment, encodeExam
    , encodeFillInInputNumeric, encodeFillInInputText, encodeFillInTheBlankQuestion
    , encodeGrading, encodeIoAnswerKey, encodeIospecAnswerKey, encodeLinting
    , encodeMultipleChoiceGradingStrategy
    , encodeMultipleSelectionQuestion, encodeShuffle
    , encodeTimeout, encodeTrueFalseGradingStrategy, encodeTrueFalseItem, encodeTrueFalseQuestion
    , encodeUnitTestQuestion
    , decodeArtifactType, decodeAssociativeItemImage, decodeAssociativeItemKeyImage
    , decodeAssociativeItemKeyText, decodeAssociativeItemText, decodeAssociativeQuestion, decodeChoice
    , decodeCodeIoConf, decodeCodingIOQuestion, decodeCompilation, decodeEnvironment, decodeExam
    , decodeFillInInputNumeric, decodeFillInInputSelection, decodeFillInInputText, decodeFillInTheBlankQuestion
    , decodeGrading, decodeIoAnswerKey, decodeIospecAnswerKey, decodeLinting
    , decodeMultipleChoiceGradingStrategy, decodeMultipleChoiceItem
    , decodeMultipleChoiceQuestion, decodeMultipleSelectionQuestion, decodeShuffle
    , decodeTimeout, decodeTrueFalseGradingStrategy, decodeTrueFalseItem, decodeTrueFalseQuestion
    , decodeUnitTestQuestion
    )

{-|


## Encoders

@docs encodeArtifactType, encodeAssociativeItemImage, encodeAssociativeItemKeyImage
@docs encodeAssociativeItemKeyText, encodeAssociativeItemText, encodeAssociativeQuestion, encodeChoice
@docs encodeCodeIoConf, encodeCodingIOQuestion, encodeCompilation, encodeEnvironment, encodeEssay, encodeExam
@docs encodeFillInInputNumeric, encodeFillInInputSelection, encodeFillInInputText, encodeFillInTheBlankQuestion
@docs encodeFootnote, encodeGradeRange, encodeGrading, encodeIoAnswerKey, encodeIospecAnswerKey, encodeLinting
@docs encodeMediaObject, encodeMediaType, encodeMultipleChoiceGradingStrategy, encodeMultipleChoiceItem
@docs encodeMultipleChoiceQuestion, encodeMultipleSelectionQuestion, encodeShuffle, encodeTextFormat
@docs encodeTimeout, encodeTrueFalseGradingStrategy, encodeTrueFalseItem, encodeTrueFalseQuestion
@docs encodeUnitTestQuestion


## Decoders

@docs decodeArtifactType, decodeAssociativeItemImage, decodeAssociativeItemKeyImage
@docs decodeAssociativeItemKeyText, decodeAssociativeItemText, decodeAssociativeQuestion, decodeChoice
@docs decodeCodeIoConf, decodeCodingIOQuestion, decodeCompilation, decodeEnvironment, decodeEssay, decodeExam
@docs decodeFillInInputNumeric, decodeFillInInputSelection, decodeFillInInputText, decodeFillInTheBlankQuestion
@docs decodeFootnote, decodeGradeRange, decodeGrading, decodeIoAnswerKey, decodeIospecAnswerKey, decodeLinting
@docs decodeMediaObject, decodeMediaType, decodeMultipleChoiceGradingStrategy, decodeMultipleChoiceItem
@docs decodeMultipleChoiceQuestion, decodeMultipleSelectionQuestion, decodeShuffle, decodeTextFormat
@docs decodeTimeout, decodeTrueFalseGradingStrategy, decodeTrueFalseItem, decodeTrueFalseQuestion
@docs decodeUnitTestQuestion

-}

import Json.Decode as D
import Json.Encode as E
import Mdq.Question exposing (..)
import Mdq.Types exposing (..)
import OpenApi.Common


decodeUnitTestQuestion : D.Decoder UnitTestQuestion
decodeUnitTestQuestion =
    D.succeed
        (\answer_key comment compilation environment epilogue footnotes forbidden_functions forbidden_modules forbidden_syntax forbidden_types format grade_range id linting media placeholder preamble stem supported_languages tags timeout title type_ weight ->
            { answer_key = answer_key
            , comment = comment
            , compilation = compilation
            , environment = environment
            , epilogue = epilogue
            , footnotes = footnotes
            , forbidden_functions = forbidden_functions
            , forbidden_modules = forbidden_modules
            , forbidden_syntax = forbidden_syntax
            , forbidden_types = forbidden_types
            , format = format
            , grade_range = grade_range
            , id = id
            , linting = linting
            , media = media
            , placeholder = placeholder
            , preamble = preamble
            , stem = stem
            , supported_languages = supported_languages
            , tags = tags
            , timeout = timeout
            , title = title
            , type_ = type_
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "answer-key" (D.succeed {}))
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "comment"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "compilation"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeCompilation
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "environment"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeEnvironment
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-functions"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-modules"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-syntax"
                (D.succeed
                    {}
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-types"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGradeRange
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "linting"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeLinting
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "placeholder"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "supported-languages"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "timeout"
                D.value
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeUnitTestQuestion : UnitTestQuestion -> E.Value
encodeUnitTestQuestion rec =
    E.object
        [ ( "answer-key", E.object [] )
        , ( "comment", E.string rec.comment )
        , ( "compilation"
          , case rec.compilation of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeCompilation value
          )
        , ( "environment"
          , case rec.environment of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeEnvironment value
          )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "forbidden-functions"
          , case rec.forbidden_functions of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "forbidden-modules"
          , case rec.forbidden_modules of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "forbidden-syntax", E.object [] )
        , ( "forbidden-types"
          , case rec.forbidden_types of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range"
          , case rec.grade_range of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGradeRange value
          )
        , ( "id", E.string rec.id )
        , ( "linting"
          , case rec.linting of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeLinting value
          )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "placeholder"
          , case rec.placeholder of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "preamble", E.string rec.preamble )
        , ( "stem", E.string rec.stem )
        , ( "supported-languages"
          , E.list E.string rec.supported_languages
          )
        , ( "tags", E.list E.string rec.tags )
        , ( "timeout", Basics.identity rec.timeout )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "weight", E.float rec.weight )
        ]


decodeTrueFalseQuestion : D.Decoder TrueFalseQuestion
decodeTrueFalseQuestion =
    D.succeed
        (\choices comment epilogue footnotes format grade_range grading id media preamble shuffle stem tags title type_ weight ->
            { choices = choices
            , comment = comment
            , epilogue = epilogue
            , footnotes = footnotes
            , format = format
            , grade_range = grade_range
            , grading = grading
            , id = id
            , media = media
            , preamble = preamble
            , shuffle = shuffle
            , stem = stem
            , tags = tags
            , title = title
            , type_ = type_
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "choices"
                (D.list decodeTrueFalseItem)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "comment"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGradeRange
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grading"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGrading
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "shuffle"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeTrueFalseQuestion : TrueFalseQuestion -> E.Value
encodeTrueFalseQuestion rec =
    E.object
        [ ( "choices", E.list encodeTrueFalseItem rec.choices )
        , ( "comment", E.string rec.comment )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range"
          , case rec.grade_range of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGradeRange value
          )
        , ( "grading"
          , case rec.grading of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGrading value
          )
        , ( "id", E.string rec.id )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "preamble", E.string rec.preamble )
        , ( "shuffle", E.bool rec.shuffle )
        , ( "stem", E.string rec.stem )
        , ( "tags", E.list E.string rec.tags )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "weight", E.float rec.weight )
        ]


decodeTrueFalseItem : D.Decoder TrueFalseItem
decodeTrueFalseItem =
    D.succeed
        (\correct feedback fixed text ->
            { correct = correct
            , feedback = feedback
            , fixed = fixed
            , text = text
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "correct" D.bool)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "feedback"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "fixed"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "text"
                D.string
            )


encodeTrueFalseItem : TrueFalseItem -> E.Value
encodeTrueFalseItem rec =
    E.object
        [ ( "correct", E.bool rec.correct )
        , ( "feedback", E.string rec.feedback )
        , ( "fixed", E.bool rec.fixed )
        , ( "text", E.string rec.text )
        ]


decodeTrueFalseGradingStrategy : D.Decoder TrueFalseGradingStrategy
decodeTrueFalseGradingStrategy =
    D.succeed
        (\correct incorrect -> { correct = correct, incorrect = incorrect })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "correct" D.float)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "incorrect"
                D.float
            )


encodeTrueFalseGradingStrategy : TrueFalseGradingStrategy -> E.Value
encodeTrueFalseGradingStrategy rec =
    E.object
        [ ( "correct", E.float rec.correct )
        , ( "incorrect", E.float rec.incorrect )
        ]


decodeTimeout : D.Decoder Timeout
decodeTimeout =
    D.string


encodeTimeout : Timeout -> E.Value
encodeTimeout =
    E.string


decodeShuffle : D.Decoder Shuffle
decodeShuffle =
    D.string


encodeShuffle : Shuffle -> E.Value
encodeShuffle =
    E.string


decodeMultipleSelectionQuestion : D.Decoder MultipleSelectionQuestion
decodeMultipleSelectionQuestion =
    D.succeed
        (\choices comment epilogue footnotes format grade_range grading id media preamble shuffle stem tags title type_ weight ->
            { choices = choices
            , comment = comment
            , epilogue = epilogue
            , footnotes = footnotes
            , format = format
            , grade_range = grade_range
            , grading = grading
            , id = id
            , media = media
            , preamble = preamble
            , shuffle = shuffle
            , stem = stem
            , tags = tags
            , title = title
            , type_ = type_
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "choices"
                (D.list decodeChoice)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "comment"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                decodeGradeRange
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grading"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "shuffle"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeMultipleSelectionQuestion : MultipleSelectionQuestion -> E.Value
encodeMultipleSelectionQuestion rec =
    E.object
        [ ( "choices", E.list encodeChoice rec.choices )
        , ( "comment", E.string rec.comment )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range", encodeGradeRange rec.grade_range )
        , ( "grading", E.string rec.grading )
        , ( "id", E.string rec.id )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "preamble", E.string rec.preamble )
        , ( "shuffle", E.bool rec.shuffle )
        , ( "stem", E.string rec.stem )
        , ( "tags", E.list E.string rec.tags )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "weight", E.float rec.weight )
        ]


decodeMultipleChoiceQuestion : D.Decoder MultipleChoiceQuestion
decodeMultipleChoiceQuestion =
    decodeQuestion
        |> D.andThen
            (\question ->
                D.map3 (MultipleChoiceQuestion question)
                    (D.field "choices" (D.array decodeMultipleChoiceItem))
                    (D.field "grading-strategy" decodeMultipleChoiceGradingStrategy)
                    (D.field "penalty" D.float)
            )


decodeMultipleChoiceItem : D.Decoder MultipleChoiceItem
decodeMultipleChoiceItem =
    D.map2 MultipleChoiceItem (D.field "id" D.string) (D.field "text" D.string)


decodeMultipleChoiceGradingStrategy : D.Decoder MultipleChoiceGradingStrategy
decodeMultipleChoiceGradingStrategy =
    D.string


encodeMultipleChoiceGradingStrategy : MultipleChoiceGradingStrategy -> E.Value
encodeMultipleChoiceGradingStrategy =
    E.string


decodeLinting : D.Decoder Linting
decodeLinting =
    D.succeed
        (\type_ -> { type_ = type_ })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        D.string
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )


encodeLinting : Linting -> E.Value
encodeLinting rec =
    E.object
        [ ( "type"
          , case rec.type_ of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.string value
          )
        ]


decodeIospecAnswerKey : D.Decoder IospecAnswerKey
decodeIospecAnswerKey =
    D.succeed
        (\iospec -> { iospec = iospec })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "iospec"
                D.string
            )


encodeIospecAnswerKey : IospecAnswerKey -> E.Value
encodeIospecAnswerKey rec =
    E.object [ ( "iospec", E.string rec.iospec ) ]


decodeIoAnswerKey : D.Decoder IoAnswerKey
decodeIoAnswerKey =
    D.succeed
        (\input output -> { input = input, output = output })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "input" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "output"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        D.string
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )


encodeIoAnswerKey : IoAnswerKey -> E.Value
encodeIoAnswerKey rec =
    E.object
        [ ( "input", E.string rec.input )
        , ( "output"
          , case rec.output of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.string value
          )
        ]


decodeGrading : D.Decoder Grading
decodeGrading =
    D.succeed
        (\strategy -> { strategy = strategy })
        |> OpenApi.Common.jsonDecodeAndMap
            (OpenApi.Common.decodeOptionalField
                "strategy"
                decodeTrueFalseGradingStrategy
            )


encodeGrading : Grading -> E.Value
encodeGrading rec =
    E.object
        (List.filterMap
            Basics.identity
            [ Maybe.map
                (\mapUnpack ->
                    ( "strategy", encodeTrueFalseGradingStrategy mapUnpack )
                )
                rec.strategy
            ]
        )


decodeFillInTheBlankQuestion : D.Decoder FillInTheBlankQuestion
decodeFillInTheBlankQuestion =
    D.succeed
        (\body comment epilogue footnotes format grade_range id media preamble stem tags title type_ weight ->
            { body = body
            , comment = comment
            , epilogue = epilogue
            , footnotes = footnotes
            , format = format
            , grade_range = grade_range
            , id = id
            , media = media
            , preamble = preamble
            , stem = stem
            , tags = tags
            , title = title
            , type_ = type_
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "body"
                (D.list D.value)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "comment"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGradeRange
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeFillInTheBlankQuestion : FillInTheBlankQuestion -> E.Value
encodeFillInTheBlankQuestion rec =
    E.object
        [ ( "body", E.list Basics.identity rec.body )
        , ( "comment", E.string rec.comment )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range"
          , case rec.grade_range of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGradeRange value
          )
        , ( "id", E.string rec.id )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "preamble", E.string rec.preamble )
        , ( "stem", E.string rec.stem )
        , ( "tags", E.list E.string rec.tags )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "weight", E.float rec.weight )
        ]


decodeFillInInputText : D.Decoder FillInInputText
decodeFillInInputText =
    D.succeed
        (\answer_key case_sensitive type_ ->
            { answer_key = answer_key
            , case_sensitive = case_sensitive
            , type_ = type_
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "answer-key" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "case-sensitive"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )


encodeFillInInputText : FillInInputText -> E.Value
encodeFillInInputText rec =
    E.object
        [ ( "answer-key", E.string rec.answer_key )
        , ( "case-sensitive", E.bool rec.case_sensitive )
        , ( "type", E.string rec.type_ )
        ]


decodeFillInInputSelection : D.Decoder FillInInputSelection
decodeFillInInputSelection =
    D.succeed
        (\choices type_ -> { choices = choices, type_ = type_ })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "choices"
                (D.list decodeMultipleChoiceItem)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "type" D.string)


decodeFillInInputNumeric : D.Decoder FillInInputNumeric
decodeFillInInputNumeric =
    D.succeed
        (\answer_key relative_tol tol type_ unit ->
            { answer_key = answer_key
            , relative_tol = relative_tol
            , tol = tol
            , type_ = type_
            , unit = unit
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "answer-key" D.float)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "relative-tol"
                D.float
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tol"
                D.float
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "unit"
                D.string
            )


encodeFillInInputNumeric : FillInInputNumeric -> E.Value
encodeFillInInputNumeric rec =
    E.object
        [ ( "answer-key", E.float rec.answer_key )
        , ( "relative-tol", E.float rec.relative_tol )
        , ( "tol", E.float rec.tol )
        , ( "type", E.string rec.type_ )
        , ( "unit", E.string rec.unit )
        ]


decodeExam : D.Decoder Exam
decodeExam =
    D.succeed
        (\id preamble questions tags title ->
            { id = id
            , preamble = preamble
            , questions = questions
            , tags = tags
            , title = title
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "id" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "questions"
                (D.list
                    D.value
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )


encodeExam : Exam -> E.Value
encodeExam rec =
    E.object
        [ ( "id", E.string rec.id )
        , ( "preamble", E.string rec.preamble )
        , ( "questions", E.list Basics.identity rec.questions )
        , ( "tags", E.list E.string rec.tags )
        , ( "title", E.string rec.title )
        ]


decodeEnvironment : D.Decoder Environment
decodeEnvironment =
    D.succeed
        (\type_ -> { type_ = type_ })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        D.string
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )


encodeEnvironment : Environment -> E.Value
encodeEnvironment rec =
    E.object
        [ ( "type"
          , case rec.type_ of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.string value
          )
        ]


decodeCompilation : D.Decoder Compilation
decodeCompilation =
    D.succeed
        (\artifact artifact_type type_ ->
            { artifact = artifact
            , artifact_type = artifact_type
            , type_ = type_
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "artifact"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        D.string
                    , D.null OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "artifact-type"
                decodeArtifactType
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        D.string
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )


encodeCompilation : Compilation -> E.Value
encodeCompilation rec =
    E.object
        [ ( "artifact"
          , case rec.artifact of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.string value
          )
        , ( "artifact-type", encodeArtifactType rec.artifact_type )
        , ( "type"
          , case rec.type_ of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.string value
          )
        ]


decodeCodingIOQuestion : D.Decoder CodingIOQuestion
decodeCodingIOQuestion =
    D.succeed
        (\answer_key comment compilation conf environment epilogue footnotes forbidden_functions forbidden_modules forbidden_syntax forbidden_types format grade_range id linting media placeholder preamble stem supported_languages tags timeout title type_ weight ->
            { answer_key = answer_key
            , comment = comment
            , compilation = compilation
            , conf = conf
            , environment = environment
            , epilogue = epilogue
            , footnotes = footnotes
            , forbidden_functions = forbidden_functions
            , forbidden_modules = forbidden_modules
            , forbidden_syntax = forbidden_syntax
            , forbidden_types = forbidden_types
            , format = format
            , grade_range = grade_range
            , id = id
            , linting = linting
            , media = media
            , placeholder = placeholder
            , preamble = preamble
            , stem = stem
            , supported_languages = supported_languages
            , tags = tags
            , timeout = timeout
            , title = title
            , type_ = type_
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "answer-key"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.list D.value)
                    , D.null OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "comment"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "compilation"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeCompilation
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "conf"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeCodeIoConf
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "environment"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeEnvironment
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-functions"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-modules"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-syntax"
                (D.succeed
                    {}
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "forbidden-types"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGradeRange
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "linting"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeLinting
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "placeholder"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        (D.succeed
                            {}
                        )
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "supported-languages"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "timeout"
                D.value
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeCodingIOQuestion : CodingIOQuestion -> E.Value
encodeCodingIOQuestion rec =
    E.object
        [ ( "answer-key"
          , case rec.answer_key of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.list Basics.identity value
          )
        , ( "comment", E.string rec.comment )
        , ( "compilation"
          , case rec.compilation of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeCompilation value
          )
        , ( "conf"
          , case rec.conf of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeCodeIoConf value
          )
        , ( "environment"
          , case rec.environment of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeEnvironment value
          )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "forbidden-functions"
          , case rec.forbidden_functions of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "forbidden-modules"
          , case rec.forbidden_modules of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "forbidden-syntax", E.object [] )
        , ( "forbidden-types"
          , case rec.forbidden_types of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range"
          , case rec.grade_range of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGradeRange value
          )
        , ( "id", E.string rec.id )
        , ( "linting"
          , case rec.linting of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeLinting value
          )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "placeholder"
          , case rec.placeholder of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    E.object []
          )
        , ( "preamble", E.string rec.preamble )
        , ( "stem", E.string rec.stem )
        , ( "supported-languages"
          , E.list E.string rec.supported_languages
          )
        , ( "tags", E.list E.string rec.tags )
        , ( "timeout", Basics.identity rec.timeout )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "weight", E.float rec.weight )
        ]


decodeCodeIoConf : D.Decoder CodeIoConf
decodeCodeIoConf =
    D.succeed
        (\case_sensitive ignore_accents match_spaces ->
            { case_sensitive = case_sensitive
            , ignore_accents = ignore_accents
            , match_spaces = match_spaces
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "case-sensitive" D.bool)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "ignore-accents"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "match-spaces"
                D.bool
            )


encodeCodeIoConf : CodeIoConf -> E.Value
encodeCodeIoConf rec =
    E.object
        [ ( "case-sensitive", E.bool rec.case_sensitive )
        , ( "ignore-accents", E.bool rec.ignore_accents )
        , ( "match-spaces", E.bool rec.match_spaces )
        ]


decodeChoice : D.Decoder Choice
decodeChoice =
    D.succeed
        (\correct feedback fixed text ->
            { correct = correct
            , feedback = feedback
            , fixed = fixed
            , text = text
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "correct" D.bool)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "feedback"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "fixed"
                D.bool
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "text"
                D.string
            )


encodeChoice : Choice -> E.Value
encodeChoice rec =
    E.object
        [ ( "correct", E.bool rec.correct )
        , ( "feedback", E.string rec.feedback )
        , ( "fixed", E.bool rec.fixed )
        , ( "text", E.string rec.text )
        ]


decodeAssociativeQuestion : D.Decoder AssociativeQuestion
decodeAssociativeQuestion =
    D.succeed
        (\comment epilogue footnotes format grade_range id keys media preamble shuffle stem tags title type_ values weight ->
            { comment = comment
            , epilogue = epilogue
            , footnotes = footnotes
            , format = format
            , grade_range = grade_range
            , id = id
            , keys = keys
            , media = media
            , preamble = preamble
            , shuffle = shuffle
            , stem = stem
            , tags = tags
            , title = title
            , type_ = type_
            , values = values
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "comment" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "epilogue"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "footnotes"
                (D.list
                    decodeFootnote
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "format"
                decodeTextFormat
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "grade-range"
                (D.oneOf
                    [ D.map
                        OpenApi.Common.Present
                        decodeGradeRange
                    , D.null
                        OpenApi.Common.Null
                    ]
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "id"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "keys"
                (D.list
                    D.value
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "media"
                (D.list
                    decodeMediaObject
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "preamble"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "shuffle"
                decodeShuffle
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "stem"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "tags"
                (D.list
                    D.string
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "title"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "values"
                (D.succeed
                    {}
                )
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "weight"
                D.float
            )


encodeAssociativeQuestion : AssociativeQuestion -> E.Value
encodeAssociativeQuestion rec =
    E.object
        [ ( "comment", E.string rec.comment )
        , ( "epilogue", E.string rec.epilogue )
        , ( "footnotes", E.list encodeFootnote rec.footnotes )
        , ( "format", encodeTextFormat rec.format )
        , ( "grade-range"
          , case rec.grade_range of
                OpenApi.Common.Null ->
                    E.null

                OpenApi.Common.Present value ->
                    encodeGradeRange value
          )
        , ( "id", E.string rec.id )
        , ( "keys", E.list Basics.identity rec.keys )
        , ( "media", E.list encodeMediaObject rec.media )
        , ( "preamble", E.string rec.preamble )
        , ( "shuffle", encodeShuffle rec.shuffle )
        , ( "stem", E.string rec.stem )
        , ( "tags", E.list E.string rec.tags )
        , ( "title", E.string rec.title )
        , ( "type", E.string rec.type_ )
        , ( "values", E.object [] )
        , ( "weight", E.float rec.weight )
        ]


decodeAssociativeItemText : D.Decoder AssociativeItemText
decodeAssociativeItemText =
    D.succeed
        (\style text -> { style = style, text = text })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "style" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "text" D.string)


encodeAssociativeItemText : AssociativeItemText -> E.Value
encodeAssociativeItemText rec =
    E.object
        [ ( "style", E.string rec.style )
        , ( "text", E.string rec.text )
        ]


decodeAssociativeItemKeyText : D.Decoder AssociativeItemKeyText
decodeAssociativeItemKeyText =
    D.succeed
        (\answer_key feedback style text ->
            { answer_key = answer_key
            , feedback = feedback
            , style = style
            , text = text
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "answer-key"
                (D.list D.string)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "feedback"
                (D.succeed {})
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "style"
                D.string
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "text"
                D.string
            )


encodeAssociativeItemKeyText : AssociativeItemKeyText -> E.Value
encodeAssociativeItemKeyText rec =
    E.object
        [ ( "answer-key", E.list E.string rec.answer_key )
        , ( "feedback", E.object [] )
        , ( "style", E.string rec.style )
        , ( "text", E.string rec.text )
        ]


decodeAssociativeItemKeyImage : D.Decoder AssociativeItemKeyImage
decodeAssociativeItemKeyImage =
    D.succeed
        (\alt answer_key feedback url ->
            { alt = alt
            , answer_key = answer_key
            , feedback = feedback
            , url = url
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "alt" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "answer-key"
                (D.list D.string)
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "feedback"
                (D.succeed {})
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "url"
                D.string
            )


encodeAssociativeItemKeyImage : AssociativeItemKeyImage -> E.Value
encodeAssociativeItemKeyImage rec =
    E.object
        [ ( "alt", E.string rec.alt )
        , ( "answer-key", E.list E.string rec.answer_key )
        , ( "feedback", E.object [] )
        , ( "url", E.string rec.url )
        ]


decodeAssociativeItemImage : D.Decoder AssociativeItemImage
decodeAssociativeItemImage =
    D.succeed
        (\alt url -> { alt = alt, url = url })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "alt" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "url" D.string)


encodeAssociativeItemImage : AssociativeItemImage -> E.Value
encodeAssociativeItemImage rec =
    E.object
        [ ( "alt", E.string rec.alt )
        , ( "url", E.string rec.url )
        ]


decodeArtifactType : D.Decoder ArtifactType
decodeArtifactType =
    D.string


encodeArtifactType : ArtifactType -> E.Value
encodeArtifactType =
    E.string
