module Data.Question.Base exposing
    ( BaseFields
    , Footnote
    , Id
    , MediaObject
    , MediaType(..)
    , QuestionBase
    , TextFormat(..)
    , ToMsg
    , decoder
    , encodeFields
    , init
    , mapBase
    , toBase
    )

import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Json.Encode.Extra as E
import Util.EnumDecode exposing (enumDecode, enumEncode)


type alias Id =
    String


type alias QuestionBase answer extra =
    { extra
        | id : Id
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
        , answer : Maybe answer
    }


type alias BaseFields =
    QuestionBase Never {}


type alias ToMsg ans msg =
    { onSetAnswer : ans -> msg }


{-| Raw initializer for questions. This initializes the common base fields to
default values.
-}
init : { id : String, title : String, stem : String } -> QuestionBase ans {}
init { id, title, stem } =
    { id = id
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
    , answer = Nothing
    }


{-| Remove the extra fields from the record
-}
toBase : QuestionBase ans extra -> BaseFields
toBase base =
    { id = base.id
    , title = base.title
    , stem = base.stem
    , format = base.format
    , weight = base.weight
    , preamble = base.preamble
    , epilogue = base.epilogue
    , footnotes = base.footnotes
    , media = base.media
    , tags = base.tags
    , comment = base.comment
    , isGraded = base.isGraded
    , answer = Nothing
    }


mapBase : (BaseFields -> a) -> QuestionBase ans extra -> a
mapBase f question =
    f (toBase question)


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


textFormat : List ( TextFormat, String )
textFormat =
    [ ( Markdown, "md" ), ( PlainText, "text" ) ]


mediaType : List ( MediaType, String )
mediaType =
    [ ( Image, "image" ), ( Video, "video" ), ( Audio, "audio" ) ]


decoder : D.Decoder ans -> D.Decoder (QuestionBase ans {})
decoder decodeAnswer =
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

        makeBase id title stem format weight preamble epilogue footnotes media tags comment isGraded answer =
            { id = id
            , title = title
            , stem = stem
            , format = format
            , weight = weight
            , preamble = preamble
            , epilogue = epilogue
            , footnotes = footnotes
            , media = media
            , tags = tags
            , comment = comment
            , isGraded = isGraded
            , answer = answer
            }
    in
    D.succeed makeBase
        |> D.required "id" D.string
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
        |> D.optional "answer" (D.maybe decodeAnswer) Nothing


encodeFields : (ans -> E.Value) -> QuestionBase ans extra -> List ( String, E.Value )
encodeFields encodeAnswer base =
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
    [ ( "id", E.string base.id )
    , ( "title", E.string base.title )
    , ( "stem", E.string base.stem )
    , ( "format", enumEncode textFormat E.string base.format )
    , ( "weight", E.float base.weight )
    , ( "preamble", E.string base.preamble )
    , ( "epilogue", E.string base.epilogue )
    , ( "footnotes", E.list footnote base.footnotes )
    , ( "media", E.list mediaObject base.media )
    , ( "tags", E.list E.string base.tags )
    , ( "comment", E.string base.comment )
    , ( "answer", E.maybe encodeAnswer base.answer )
    ]
