module Data._Question.Base exposing
    ( MediaType(..)
    , Question
    , QuestionType(..)
    , TextFormat(..)
    , decode
    , decodeType
    , encode
    , initUnsafe
    )

import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Util.EnumDecode exposing (enumDecode, enumEncode)


type alias Question input =
    { id : String
    , type_ : QuestionType
    , title : String
    , stem : String
    , format : TextFormat
    , weight : Float
    , preamble : String
    , epilogue : String
    , footnotes : List Footnote
    , media : List MediaObject
    , tags : List String
    , comment : String
    , isGraded : Bool
    , input : input
    }


{-| Raw initializer for questions. This is a helper function to create safe
initializers that ensure input type is compatible with the question type.
-}
initUnsafe : QuestionType -> { id : String, title : String, stem : String } -> input -> Question input
initUnsafe type_ { id, title, stem } input =
    { id = id
    , type_ = type_
    , title = title
    , stem = stem
    , format = Markdown
    , weight = 100
    , preamble = ""
    , epilogue = ""
    , footnotes = []
    , media = []
    , tags = []
    , comment = ""
    , isGraded = False
    , input = input
    }


type QuestionType
    = Essay
    | MultipleChoice
    | MultipleSelect
    | TrueFalse
    | FillIn
    | Associative
    | CodeIO
    | UnitTest


type MediaType
    = Image
    | Video
    | Audio


type TextFormat
    = Markdown
    | PlainText


type alias Footnote =
    { id : String
    , text : String
    }


type alias MediaObject =
    { id : String
    , type_ : MediaType
    , url : String
    , caption : String
    }


questionType : List ( QuestionType, String )
questionType =
    [ ( Essay, "essay" )
    , ( MultipleChoice, "multiple-choice" )
    , ( MultipleSelect, "multiple-select" )
    , ( TrueFalse, "true-false" )
    , ( FillIn, "fill-in" )
    , ( Associative, "associative" )
    , ( CodeIO, "code-io" )
    , ( UnitTest, "unit-test" )
    ]


textFormat : List ( TextFormat, String )
textFormat =
    [ ( Markdown, "md" ), ( PlainText, "text" ) ]


mediaType : List ( MediaType, String )
mediaType =
    [ ( Image, "image" ), ( Video, "video" ), ( Audio, "audio" ) ]


decode : D.Decoder (input -> Question input)
decode =
    let
        footnoteD =
            D.map2 Footnote
                (D.field "id" D.string)
                (D.field "text" D.string)

        mediaObjectD =
            D.succeed MediaObject
                |> D.required "id" D.string
                |> D.required "type" (enumDecode mediaType D.string)
                |> D.required "url" D.string
                |> D.optional "caption" D.string ""
    in
    D.succeed Question
        |> D.required "id" D.string
        |> D.required "type" decodeType
        |> D.optional "title" D.string ""
        |> D.optional "stem" D.string ""
        |> D.optional "format" (enumDecode textFormat D.string) Markdown
        |> D.optional "weight" D.float 100
        |> D.optional "preamble" D.string ""
        |> D.optional "epilogue" D.string ""
        |> D.optional "footnotes" (D.list footnoteD) []
        |> D.optional "media" (D.list mediaObjectD) []
        |> D.optional "tags" (D.list D.string) []
        |> D.optional "comment" D.string ""
        |> D.optional "is-graded" D.bool False


encode : (input -> List ( String, E.Value )) -> Question input -> E.Value
encode enc question =
    let
        footnote rec =
            E.object
                [ ( "id", E.string rec.id )
                , ( "text", E.string rec.text )
                ]

        mediaObject rec =
            E.object
                [ ( "id", E.string rec.id )
                , ( "type", enumEncode mediaType E.string rec.type_ )
                , ( "url", E.string rec.url )
                , ( "caption", E.string rec.caption )
                ]
    in
    E.object
        ([ ( "id", E.string question.id )
         , ( "type", enumEncode questionType E.string question.type_ )
         , ( "title", E.string question.title )
         , ( "stem", E.string question.stem )
         , ( "format", enumEncode textFormat E.string question.format )
         , ( "weight", E.float question.weight )
         , ( "preamble", E.string question.preamble )
         , ( "epilogue", E.string question.epilogue )
         , ( "footnotes", E.list footnote question.footnotes )
         , ( "media", E.list mediaObject question.media )
         , ( "tags", E.list E.string question.tags )
         , ( "comment", E.string question.comment )
         ]
            ++ enc question.input
        )


decodeType : D.Decoder QuestionType
decodeType =
    enumDecode questionType D.string
